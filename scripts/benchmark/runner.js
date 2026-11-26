// Seen Aloud benchmark runner. Paste into the DevTools console on https://seen-aloud.web.app
// (or a local build), then run, for example:
//
//   await seenAloudBenchmark({ videoUrl: '/benchmark/02-software-tutorial.mp4', mode: 'cloud' })
//
// It drives the real app (no mocks): opens the video, presses "Describe this video",
// accepts the cloud consent when `acceptCloud` is true, waits for the track, and returns
// what the app and the network did. Copy the returned object into results/*.json.
// Every number comes from this run: the clock, the fetch calls to Firebase AI Logic
// (request and response sizes in bytes), the ledger the app shows, and the lines it wrote.

(() => {
  const AI_ENDPOINT = /firebasevertexai\.googleapis\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/;
  const requests = [];

  if (!window.__seenAloudFetchWrapped) {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!AI_ENDPOINT.test(url)) return original(input, init);
      const body = init && typeof init.body === 'string' ? init.body : '';
      const record = { model: (url.match(/models\/([^:]+)/) || [])[1] || '', startMs: performance.now(), requestBytes: new Blob([body]).size };
      requests.push(record);
      try {
        const response = await original(input, init);
        record.status = response.status;
        record.responseBytes = (await response.clone().blob()).size;
        record.ms = Math.round(performance.now() - record.startMs);
        return response;
      } catch (error) {
        record.error = String(error);
        record.ms = Math.round(performance.now() - record.startMs);
        throw error;
      }
    };
    window.__seenAloudFetchWrapped = true;
    window.__seenAloudRequests = requests;
  }

  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(test, timeoutMs, label) {
    const t0 = performance.now();
    while (!test()) {
      if (performance.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
      await wait(200);
    }
  }

  window.seenAloudBenchmark = async ({ videoUrl, mode = 'cloud', acceptCloud = true, timeoutMs = 600000 }) => {
    const log = window.__seenAloudRequests;
    const radio = document.querySelector(`input[name="mode"][value="${mode}"]`);
    if (!radio) throw new Error(`Unknown mode ${mode}`);
    radio.click();

    const blob = await (await fetch(videoUrl)).blob();
    const file = new File([blob], videoUrl.split('/').pop(), { type: blob.type || 'video/mp4' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    $('file').files = transfer.files;
    $('file').dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => !$('player').hidden && !$('analyze').disabled, 30000, 'the player');
    await wait(500);

    const firstRequest = log.length;
    const started = performance.now();
    $('analyze').click();
    let consentShown = false;
    await until(() => {
      const dialog = $('consent');
      if (dialog.open) {
        consentShown = true;
        dialog.querySelector(`button[value="${acceptCloud ? 'yes' : 'no'}"]`).click();
      }
      return $('cancel').hidden && performance.now() - started > 300;
    }, timeoutMs, 'the track');
    const totalMs = Math.round(performance.now() - started);

    const cues = [...$('cues').querySelectorAll('li')].map((li) => {
      const [used, budget] = (li.querySelector('.words')?.textContent || '').split(/[/ ]/).map(Number);
      const stamp = (li.querySelector('.time')?.getAttribute('aria-label') || '').match(/(\d+):(\d+):(\d+)\.(\d+)/);
      const badges = [...li.querySelectorAll('.badge')].map((b) => b.textContent);
      return {
        time: li.querySelector('.time')?.textContent,
        start: stamp ? Number(stamp[1]) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]) + Number(stamp[4]) / 1000 : null,
        extended: badges.includes('Pauses video'),
        badges,
        words: used,
        budget,
        text: li.querySelector('textarea')?.value || '',
      };
    });
    const calls = log.slice(firstRequest).map(({ model, status, ms, requestBytes, responseBytes, error }) => ({
      model, status, ms, requestBytes, responseBytes, error,
    }));
    return {
      video: videoUrl,
      mode,
      consentShown,
      acceptCloud,
      totalMs,
      message: $('progress-text').textContent,
      ledger: {
        requestsOnDevice: Number($('m-device').textContent),
        requestsInCloud: Number($('m-cloud').textContent),
        framesThatLeft: Number($('m-frames').textContent),
        note: $('ledger-note').textContent,
        log: [...$('log').querySelectorAll('li')].map((li) => li.textContent).reverse(),
      },
      network: {
        aiRequests: calls.length,
        bytesSent: calls.reduce((s, c) => s + (c.requestBytes || 0), 0),
        bytesReceived: calls.reduce((s, c) => s + (c.responseBytes || 0), 0),
        calls,
      },
      cues,
      environment: { userAgent: navigator.userAgent, bundle: [...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/index-')) || '' },
    };
  };
})();
