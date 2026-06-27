/*
 * Twilio WhatsApp notifier.
 *
 * Required secrets:
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - TWILIO_WHATSAPP_FROM, for example: whatsapp:+14155238886
 * - WHATSAPP_TO, for example: whatsapp:+16285550100
 *
 * Optional template secrets for business-initiated messages:
 * - TWILIO_CONTENT_SID
 * - TWILIO_CONTENT_VARIABLES
 */

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';
const MAX_BODY_CHARS = Number.parseInt(process.env.WHATSAPP_MAX_BODY_CHARS || '1400', 10);

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeWhatsAppNumber(value) {
  if (!value) return value;
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
}

function splitText(text, maxChars = MAX_BODY_CHARS) {
  const value = String(text || '').trim();
  if (!value) return [];

  const chunks = [];
  let remaining = value;

  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf('\n', maxChars);
    if (cut < Math.floor(maxChars * 0.6)) cut = maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendTwilioForm(params) {
  const accountSid = getRequiredEnv('TWILIO_ACCOUNT_SID');
  const authToken = getRequiredEnv('TWILIO_AUTH_TOKEN');
  const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const body = new URLSearchParams(params);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio WhatsApp send failed: HTTP ${response.status} ${responseText}`);
  }

  return JSON.parse(responseText);
}

async function sendWhatsAppText(text) {
  const from = normalizeWhatsAppNumber(getRequiredEnv('TWILIO_WHATSAPP_FROM'));
  const to = normalizeWhatsAppNumber(getRequiredEnv('WHATSAPP_TO'));
  const chunks = splitText(text);
  const results = [];

  for (const chunk of chunks) {
    results.push(await sendTwilioForm({ From: from, To: to, Body: chunk }));
  }

  return results;
}

async function sendWhatsAppTemplate(variables = {}) {
  const from = normalizeWhatsAppNumber(getRequiredEnv('TWILIO_WHATSAPP_FROM'));
  const to = normalizeWhatsAppNumber(getRequiredEnv('WHATSAPP_TO'));
  const contentSid = getRequiredEnv('TWILIO_CONTENT_SID');
  const contentVariables = process.env.TWILIO_CONTENT_VARIABLES || JSON.stringify(variables);

  return [
    await sendTwilioForm({
      From: from,
      To: to,
      ContentSid: contentSid,
      ContentVariables: contentVariables
    })
  ];
}

async function sendWhatsAppReport(text, templateVariables = {}) {
  if (process.env.TWILIO_CONTENT_SID) {
    return sendWhatsAppTemplate(templateVariables);
  }

  return sendWhatsAppText(text);
}

module.exports = {
  sendWhatsAppReport,
  sendWhatsAppText,
  sendWhatsAppTemplate,
  splitText
};
