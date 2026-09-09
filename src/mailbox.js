// A disposable inbox for the account registrations that gate some application
// forms. Uses mail.tm, which hands out a real IMAP-backed address over a plain
// REST API -- no OAuth, and it never touches a personal mailbox.
import fs from 'node:fs/promises';

const API = 'https://api.mail.tm';
const STORE = 'data/identity.json';

// mail.tm rate-limits aggressively; a short backoff makes it reliable.
async function api(path, opts = {}, attempt = 0) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    return api(path, opts, attempt + 1);
  }
  if (!res.ok) throw new Error(`mail.tm ${path} -> ${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

// The persona used for every registration. Stored so a rerun reuses the same
// account rather than littering portals with new ones.
export async function loadIdentity() {
  const existing = await fs.readFile(STORE, 'utf8').catch(() => null);
  if (existing) {
    const id = JSON.parse(existing);
    id.token = await login(id.email, id.mailPassword).catch(() => id.token);
    return id;
  }

  // mail.tm answers with a bare array for application/json and a hydra
  // collection for ld+json, so accept either.
  const domain = asList(await api('/domains')).find((d) => d.isActive)?.domain;
  const tag = Math.random().toString(36).slice(2, 7);
  const email = `jordan.avery.${tag}@${domain}`;
  const mailPassword = `Fm${Math.random().toString(36).slice(2, 12)}!7Qx`;

  // mail.tm normalizes addresses (it strips dots), and the login must use the
  // canonical form it returns, not the one that was requested.
  const account = await api('/accounts', {
    method: 'POST',
    body: JSON.stringify({ address: email, password: mailPassword }),
  });
  const address = account.address || email;
  const token = await login(address, mailPassword);

  const identity = {
    email: address,
    mailPassword,
    token,
    // Credentials used for the employer-portal accounts themselves.
    portalPassword: `Ap${Math.random().toString(36).slice(2, 10)}!2Zr`,
    firstName: 'Jordan',
    lastName: 'Avery',
    fullName: 'Jordan Avery',
    phone: '4155550137',
    address: '1160 Battery St',
    city: 'San Francisco',
    state: 'California',
    stateCode: 'CA',
    postalCode: '94111',
    country: 'United States',
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(STORE, JSON.stringify(identity, null, 2));
  return identity;
}

async function login(address, password) {
  const r = await api('/token', { method: 'POST', body: JSON.stringify({ address, password }) });
  return r.token;
}

const asList = (r) => (Array.isArray(r) ? r : r?.['hydra:member'] || []);

export async function listMessages(identity) {
  return asList(await api('/messages', { token: identity.token }));
}

export async function readMessage(identity, id) {
  return api(`/messages/${id}`, { token: identity.token });
}

const CODE_RE = /\b(\d{4,8})\b/;
const CODE_CONTEXT = /(verification|confirm|security|one[- ]?time|access|activation|passcode)[^\d]{0,40}(\d{4,8})|(\d{4,8})[^\d]{0,40}(is your|verification|confirm)/i;

// Waits for a message that arrives after `since` and looks like a verification,
// then pulls out whichever of a code or a confirmation link it carries.
export async function waitForVerification(identity, { since = Date.now(), timeoutMs = 120000, match } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await listMessages(identity).catch(() => []);
    for (const m of messages) {
      if (new Date(m.createdAt).getTime() < since - 5000) continue;
      if (match && !match.test(`${m.subject} ${m.from?.address || ''}`)) continue;
      const full = await readMessage(identity, m.id).catch(() => null);
      if (!full) continue;
      const body = `${full.subject || ''}\n${full.text || ''}\n${(full.html || []).join('\n')}`;
      const ctx = body.match(CODE_CONTEXT);
      const code = ctx ? (ctx[2] || ctx[3]) : (body.match(CODE_RE) || [])[1];
      const link = (body.match(/https?:\/\/[^\s"'<>)]{20,400}/g) || []).find((u) =>
        /verify|confirm|activat|token|validate|email/i.test(u)
      );
      if (code || link) {
        return { code, link, subject: full.subject, from: full.from?.address, id: m.id };
      }
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
}
