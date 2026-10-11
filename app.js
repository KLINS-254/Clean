
const response = await fetch('/api/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ username, password })
});

const contentType = response.headers.get('content-type') || '';

if (!contentType.includes('application/json')) {
  const message = await response.text();
  throw new Error(
    `Server returned ${response.status}, not JSON: ${message.slice(0, 200)}`
  );
}

const data = await response.json();

if (!response.ok) {
  throw new Error(data.error || 'Login failed.');
}

localStorage.setItem('token', data.token);
localStorage.setItem('user', JSON.stringify(data.user));
window.location.href = '/dashboard.html';
