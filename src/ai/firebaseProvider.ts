import {
  getGenerativeModel,
  type AI,
  type GenerativeModel,
  type LanguageModelExpected,
  type Part,
} from 'firebase/ai';
import type { AppSettings } from '../config/settings';
import type { DescriptionLanguage } from '../core/types';
import type { DeviceAvailability, InferenceModeValue, ModelProvider, PromptPart, Task, TaskModel } from './engine';
import { FIT_SCHEMA, FRAME_NOTE_SCHEMA, SCRIPT_SCHEMA } from './schemas';

const SCHEMAS: Record<Task, Record<string, unknown>> = {
  frameNote: FRAME_NOTE_SCHEMA,
  script: SCRIPT_SCHEMA,
  fit: FIT_SCHEMA,
};

const TEMPERATURE: Record<Task, number> = { frameNote: 0.2, script: 0.4, fit: 0.2 };

/** Prompts are written in English; frame notes also carry one image. */
export function expectedInputs(task: Task): LanguageModelExpected[] {
  const text: LanguageModelExpected = { type: 'text', languages: ['en'] };
  return task === 'frameNote' ? [text, { type: 'image' }] : [text];
}

export function expectedOutputs(language: DescriptionLanguage): LanguageModelExpected[] {
  return [{ type: 'text', languages: [language] }];
}

const AVAILABILITY_VALUES: readonly DeviceAvailability[] = ['unavailable', 'downloadable', 'downloading', 'available'];

interface PromptApi {
  availability(options: unknown): Promise<string>;
}

/** Chrome's own capability check for the options the frame model uses; not inference. */
export async function readDeviceAvailability(language: DescriptionLanguage): Promise<DeviceAvailability> {
  const api = (globalThis as { LanguageModel?: PromptApi }).LanguageModel;
  if (!api || typeof api.availability !== 'function') return 'unsupported';
  try {
    const value = await api.availability({
      expectedInputs: expectedInputs('frameNote'),
      expectedOutputs: expectedOutputs(language),
    });
    return (AVAILABILITY_VALUES as readonly string[]).includes(value) ? (value as DeviceAvailability) : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Firebase AI Logic hybrid models, one per task, inference mode and output
 * language. The same JSON Schema constrains the on-device answer
 * (`responseConstraint`) and the cloud answer (`responseJsonSchema`).
 */
export class FirebaseModelProvider implements ModelProvider {
  private readonly models = new Map<string, GenerativeModel>();

  constructor(
    private readonly ai: AI,
    private readonly settings: () => AppSettings,
  ) {}

  generativeModel(task: Task, mode: InferenceModeValue, language: DescriptionLanguage): GenerativeModel {
    const cloudModel = this.settings().cloudModel;
    const key = [task, mode, language, cloudModel].join('|');
    const cached = this.models.get(key);
    if (cached) return cached;

    const schema = SCHEMAS[task];
    const model = getGenerativeModel(this.ai, {
      mode,
      inCloudParams: {
        model: cloudModel,
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature: TEMPERATURE[task],
        },
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs: expectedInputs(task),
          expectedOutputs: expectedOutputs(language),
        },
        promptOptions: { responseConstraint: schema },
      },
    });
    this.models.set(key, model);
    return model;
  }

  model(task: Task, mode: InferenceModeValue, language: DescriptionLanguage): TaskModel {
    const generative = this.generativeModel(task, mode, language);
    return {
      async generate(parts: PromptPart[]) {
        const result = await generative.generateContent(parts as Part[]);
        return {
          text: result.response.text(),
          source: result.response.inferenceSource === 'on_device' ? 'on_device' : 'in_cloud',
        };
      },
    };
  }

  /**
   * Reads Chrome's own availability for the same options the frame model uses.
   * This is a capability check, not inference; every prompt goes through
   * Firebase AI Logic.
   */
  deviceAvailability(language: DescriptionLanguage): Promise<DeviceAvailability> {
    return readDeviceAvailability(language);
  }

  /** Must run inside a click handler: Chrome only starts the download on a user gesture. */
  async prepareDevice(language: DescriptionLanguage, onProgress: (fraction: number) => void): Promise<void> {
    await this.generativeModel('frameNote', 'prefer_on_device', language).initializeDeviceModel(onProgress);
  }
}
