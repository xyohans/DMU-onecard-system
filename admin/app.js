const API = '/api/admin';
const TOKEN_KEY = 'meal-card-admin-token';

const loginPanel = document.querySelector('#login-panel');
const dashboard = document.querySelector('#dashboard');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const dashboardMessage = document.querySelector('#dashboard-message');
const staffList = document.querySelector('#staff-list');
const staffCount = document.querySelector('#staff-count');
const emptyState = document.querySelector('#empty-state');
const adminInfo = document.querySelector('#admin-info');
const adminName = document.querySelector('#admin-name');
const passwordDialog = document.querySelector('#password-dialog');
const passwordOutput = document.querySelector('#temporary-password');
const passwordTitle = document.querySelector('#password-title');

let token = sessionStorage.getItem(TOKEN_KEY);
for (let gate = 1; gate <= 9; gate += 1) {
  const option = document.createElement('option');
  option.value = String(gate);
  option.textContent = `Gate ${gate}`;
  document.querySelector('#create-form [name="gate"]').append(option);
}

function showLogin(message = '') {
  token = null;
  sessionStorage.removeItem(TOKEN_KEY);
  loginPanel.hidden = false;
  dashboard.hidden = true;
  adminInfo.hidden = true;
  loginMessage.textContent = message;
}

function showDashboard(admin) {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  adminInfo.hidden = false;
  adminName.textContent = admin.full_name || admin.email;
}

function setNotice(message, isError = false) {
  dashboardMessage.textContent = message;
  dashboardMessage.classList.toggle('notice-error', isError);
  dashboardMessage.hidden = !message;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin('Your admin session ended. Please sign in again.');
    throw new Error('Your admin session ended. Please sign in again.');
  }
  if (!response.ok) {
    const messages = {
      EMAIL_IN_USE: 'That email is already used by another account.',
      SESSION_ALREADY_ACTIVE: 'This admin account is already signed in elsewhere. Revoke its active session before signing in here.',
      ACCOUNT_INACTIVE: 'This administrator account is inactive.'
    };
    throw new Error(messages[data.status] || 'The request could not be completed. Please try again.');
  }
  return data;
}

function field(labelText, name, value, type = 'text') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.name = name;
  input.value = value ?? '';
  input.type = type;
  input.required = true;
  if (name === 'email') {
    input.maxLength = 150;
    input.autocomplete = 'email';
  } else {
    input.maxLength = 150;
  }
  label.append(input);
  return label;
}

function selectField(labelText, name, selected, maximum, prefix) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  select.name = name;
  select.required = true;
  for (let value = 1; value <= maximum; value += 1) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${prefix} ${value}`;
    option.selected = Number(selected) === value;
    select.append(option);
  }
  label.append(select);
  return label;
}

function actionButton(text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${className}`;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function renderStaff(records) {
  staffList.replaceChildren();
  staffCount.textContent = `${records.length} ${records.length === 1 ? 'account' : 'accounts'}`;
  emptyState.hidden = records.length !== 0;

  for (const staff of records) {
    const card = document.createElement('article');
    card.className = 'staff-card';

    const heading = document.createElement('div');
    heading.className = 'staff-card-heading';
    const identity = document.createElement('div');
    const name = document.createElement('h3');
    name.textContent = staff.full_name;
    const email = document.createElement('div');
    email.className = 'staff-email';
    email.textContent = staff.email;
    identity.append(name, email);

    const badges = document.createElement('div');
    badges.className = 'badges';
    const status = document.createElement('span');
    status.className = `badge ${staff.is_active ? '' : 'badge-disabled'}`;
    status.textContent = staff.is_active ? 'Active' : 'Disabled';
    const session = document.createElement('span');
    session.className = `badge ${staff.session_active ? 'badge-online' : 'badge-offline'}`;
    session.textContent = staff.session_active ? 'Signed in' : 'Signed out';
    badges.append(status, session);
    heading.append(identity, badges);

    const form = document.createElement('form');
    form.className = 'edit-form';
    form.append(
      field('Full name', 'full_name', staff.full_name),
      field('Email', 'email', staff.email, 'email'),
      selectField('Cafeteria', 'cafeteria_id', staff.cafeteria_id, 2, 'Cafeteria'),
      selectField('Gate', 'gate', staff.gate, 9, 'Gate')
    );
    const activeLabel = document.createElement('label');
    activeLabel.className = 'active-field';
    const active = document.createElement('input');
    active.type = 'checkbox';
    active.name = 'is_active';
    active.checked = Boolean(Number(staff.is_active));
    activeLabel.append(active, document.createTextNode('Account enabled'));
    form.append(activeLabel);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'button button-primary';
    save.textContent = 'Save changes';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        const values = new FormData(form);
        const result = await request(`/staff/${staff.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            full_name: values.get('full_name'),
            email: values.get('email'),
            cafeteria_id: values.get('cafeteria_id'),
            gate: values.get('gate'),
            is_active: active.checked ? 1 : 0
          })
        });
        setNotice(result.sessionRevoked
          ? 'Staff account updated. Its previous phone session was ended.'
          : 'Staff account updated.');
        await refreshStaff();
      } catch (error) {
        setNotice(error.message, true);
      } finally {
        save.disabled = false;
      }
    });

    const reset = actionButton('Reset password', 'button-quiet', async () => {
      if (!window.confirm(`Generate a new password for ${staff.full_name}? Their active session will be ended.`)) return;
      try {
        const result = await request(`/staff/${staff.id}/reset-password`, { method: 'POST' });
        showPassword(`New password for ${staff.full_name}`, result.temporaryPassword);
        setNotice('Password reset. The staff member was signed out.');
        await refreshStaff();
      } catch (error) {
        setNotice(error.message, true);
      }
    });
    const revoke = actionButton('Revoke session', 'button-danger', async () => {
      if (!window.confirm(`Sign ${staff.full_name} out of their phone?`)) return;
      try {
        const result = await request(`/staff/${staff.id}/revoke`, { method: 'POST' });
        setNotice(result.revoked ? 'Staff session revoked.' : 'This staff account had no active session.');
        await refreshStaff();
      } catch (error) {
        setNotice(error.message, true);
      }
    });
    actions.append(save, reset, revoke);
    card.append(heading, form, actions);
    staffList.append(card);
  }
}

async function refreshStaff() {
  const result = await request('/staff');
  renderStaff(result.staff);
}

function showPassword(title, password) {
  passwordTitle.textContent = title;
  passwordOutput.textContent = password;
  passwordDialog.showModal();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  loginMessage.textContent = '';
  try {
    const values = new FormData(loginForm);
    const result = await request('/login', {
      method: 'POST',
      body: JSON.stringify({ email: values.get('email'), password: values.get('password') })
    });
    token = result.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    loginForm.reset();
    showDashboard(result.admin);
    setNotice('');
    await refreshStaff();
  } catch (error) {
    loginMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = new FormData(form);
    const result = await request('/staff', {
      method: 'POST',
      body: JSON.stringify({
        full_name: values.get('full_name'),
        email: values.get('email'),
        cafeteria_id: values.get('cafeteria_id'),
        gate: values.get('gate')
      })
    });
    form.reset();
    showPassword(`Initial password for ${result.staff.full_name}`, result.temporaryPassword);
    setNotice('Staff account created. Save the temporary password; it is displayed only once.');
    await refreshStaff();
  } catch (error) {
    setNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#refresh-button').addEventListener('click', async () => {
  try {
    await refreshStaff();
    setNotice('Staff list refreshed.');
  } catch (error) {
    setNotice(error.message, true);
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await request('/logout', { method: 'POST' });
    showLogin();
  } catch (error) {
    setNotice(error.message, true);
  }
});

document.querySelector('#copy-password').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(passwordOutput.textContent);
    document.querySelector('#copy-password').textContent = 'Copied';
  } catch {
    setNotice('Clipboard access is unavailable. Select and copy the password manually.', true);
  }
});

document.querySelector('#close-password').addEventListener('click', () => {
  passwordDialog.close();
  passwordOutput.textContent = '';
  document.querySelector('#copy-password').textContent = 'Copy password';
});

async function boot() {
  if (!token) {
    showLogin();
    return;
  }
  try {
    const { admin } = await request('/session');
    showDashboard(admin);
    await refreshStaff();
  } catch (error) {
    if (token) showLogin(error.message);
  }
}

boot();
