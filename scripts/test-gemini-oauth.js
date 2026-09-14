const { execSync } = require('child_process');
const https = require('https');

async function main() {
  console.log('Fetching local gcloud access token...');
  let token;
  try {
    token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error('Failed to obtain gcloud access token. Verify the Google Cloud SDK is installed and authenticated (run `gcloud auth login`).', err.message);
    process.exitCode = 1;
    return;
  }

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  
  const payload = JSON.stringify({
    contents: [{
      role: 'user',
      parts: [{
        text: 'Hello, respond with success.'
      }]
    }]
  });

  return new Promise((resolve, reject) => {
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
        console.log('Status Code:', res.statusCode);
        console.log('Response Body:', body);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          process.exitCode = 1;
          reject(new Error(`API returned HTTP status ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });

    req.setTimeout(30000, () => {
      console.error('Request timed out after 30 seconds.');
      req.destroy(new Error('Request timed out'));
    });

    req.on('error', (e) => {
      console.error('Request error:', e.message);
      process.exitCode = 1;
      reject(e);
    });

    req.write(payload);
    req.end();
  });
}

main().catch(err => {
  console.error('Test failed:', err.message);
  process.exitCode = 1;
});
