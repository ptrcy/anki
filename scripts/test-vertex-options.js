const { execSync } = require('child_process');
const https = require('https');

function makeRequest(url, token) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{
          text: 'Hello'
        }]
      }]
    });

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', (e) => {
      resolve({ status: 'ERROR', body: e.message });
    });

    req.write(payload);
    req.end();
  });
}

async function main() {
  const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  const projectId = 'gen-lang-client-0670059811';
  const location = 'us-central1';

  const configs = [
    { version: 'v1', model: 'gemini-1.5-flash-001' },
    { version: 'v1', model: 'gemini-1.5-flash-002' },
    { version: 'v1', model: 'gemini-1.5-flash' },
    { version: 'v1', model: 'gemini-1.5-pro-001' },
    { version: 'v1', model: 'gemini-1.5-pro-002' },
    { version: 'v1', model: 'gemini-1.5-pro' },
    { version: 'v1beta1', model: 'gemini-1.5-flash-001' },
    { version: 'v1beta1', model: 'gemini-1.5-flash' },
    { version: 'v1beta1', model: 'gemini-1.5-pro' },
    { version: 'v1beta1', model: 'gemini-2.0-flash-exp' }
  ];

  for (const cfg of configs) {
    const url = `https://${location}-aiplatform.googleapis.com/${cfg.version}/projects/${projectId}/locations/${location}/publishers/google/models/${cfg.model}:generateContent`;
    console.log(`Testing ${cfg.version} with model: ${cfg.model}...`);
    const res = await makeRequest(url, token);
    console.log(`Status: ${res.status}`);
    if (res.status === 200) {
      console.log('SUCCESS!');
      console.log(res.body);
      break;
    } else {
      console.log(res.body.slice(0, 300));
    }
  }
}

main().catch(console.error);
