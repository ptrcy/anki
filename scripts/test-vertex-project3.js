const { execSync } = require('child_process');
const https = require('https');

async function main() {
  console.log('Fetching local gcloud access token...');
  const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  const projectId = 'project-b93bafc4-34a9-419a-9e0';
  const model = 'gemini-1.5-flash';
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;

  console.log(`Testing call to Vertex AI in project ${projectId}...`);

  const payload = JSON.stringify({
    contents: [{
      role: 'user',
      parts: [{
        text: 'Hello, respond with success.'
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
      console.log('Status Code:', res.statusCode);
      console.log('Response Body:', body);
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e.message);
  });

  req.write(payload);
  req.end();
}

main().catch(console.error);
