const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const button = form.querySelector('button');
  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;
  if (!username || !password) {
    showError('Vyplňte jméno i heslo.');
    return;
  }
  button.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      window.location.replace('/');
      return;
    }
    const data = await res.json().catch(() => ({}));
    showError(data.error || 'Přihlášení se nepodařilo.');
    form.elements.password.value = '';
    form.elements.password.focus();
  } catch {
    showError('Server je nedostupný. Zkuste to znovu.');
  } finally {
    button.disabled = false;
  }
});
