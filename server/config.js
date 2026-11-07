'use strict';
const path = require('path');

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  const appUrl = (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');
  const cfg = {
    prod,
    port: int(env.PORT, 3000),
    appUrl,
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'manager.db'),
    tokenKey: env.TOKEN_KEY || '',
    supportEmail: /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/.test(env.SUPPORT_EMAIL || '') ? env.SUPPORT_EMAIL : '',
    publicDir: path.join(__dirname, '..', 'public'),
    sessionDays: 30,
    logRequests: env.LOG_REQUESTS ? env.LOG_REQUESTS === '1' : prod,
    mail: { mode: env.MAIL_MODE || (env.RESEND_API_KEY ? 'resend' : 'console'), key: env.RESEND_API_KEY, from: env.MAIL_FROM || 'Synthia <no-reply@localhost>', base: env.RESEND_BASE || 'https://api.resend.com' },
    ai: {
      default: env.AI_DEFAULT || 'claude',
      dailyQuota: int(env.AI_DAILY_QUOTA, 30),
      timeoutMs: int(env.AI_TIMEOUT_MS, 20000),
      providers: {
        claude: { key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', base: env.ANTHROPIC_BASE || 'https://api.anthropic.com' },
        gemini: { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', base: env.GEMINI_BASE || 'https://generativelanguage.googleapis.com' },
        grok: { key: env.XAI_API_KEY, model: env.XAI_MODEL || 'grok-4', base: env.XAI_BASE || 'https://api.x.ai' },
      },
    },
    pay: {
      mode: env.PAY_MODE || 'simulate',
      price: int(env.PREMIUM_PRICE, 5000),
      days: 30,
      fedapay: { key: env.FEDAPAY_SECRET_KEY, env: env.FEDAPAY_ENV || 'sandbox', webhookSecret: env.FEDAPAY_WEBHOOK_SECRET },
    },
    social: {
      tiktok: { id: env.TIKTOK_CLIENT_KEY, secret: env.TIKTOK_CLIENT_SECRET, base: env.TIKTOK_BASE || 'https://open.tiktokapis.com', authUrl: env.TIKTOK_AUTH_URL || 'https://www.tiktok.com/v2/auth/authorize/' },
      instagram: { id: env.INSTAGRAM_CLIENT_ID, secret: env.INSTAGRAM_CLIENT_SECRET, base: env.INSTAGRAM_BASE || 'https://api.instagram.com', graph: env.INSTAGRAM_GRAPH || 'https://graph.instagram.com', authUrl: env.INSTAGRAM_AUTH_URL || 'https://www.instagram.com/oauth/authorize' },
      youtube: { id: env.YOUTUBE_CLIENT_ID, secret: env.YOUTUBE_CLIENT_SECRET, base: env.YOUTUBE_BASE || 'https://oauth2.googleapis.com', api: env.YOUTUBE_API || 'https://www.googleapis.com', authUrl: env.YOUTUBE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth' },
    },
  };
  return cfg;
}

function validateConfig(cfg) {
  const errs = [];
  if (cfg.prod) {
    if (!cfg.tokenKey) errs.push('TOKEN_KEY manquant');
    if (cfg.pay.mode === 'simulate') errs.push('PAY_MODE=simulate est interdit en production');
    if (cfg.mail.mode === 'console') errs.push('MAIL_MODE=console n’envoie aucun e-mail : configure RESEND_API_KEY et MAIL_FROM');
    if (!cfg.appUrl.startsWith('https://')) errs.push('APP_URL doit être en https en production');
  }
  if (cfg.tokenKey && Buffer.from(cfg.tokenKey, 'base64').length !== 32) errs.push('TOKEN_KEY doit faire 32 octets (base64)');
  if (cfg.pay.mode === 'fedapay' && !cfg.pay.fedapay.key) errs.push('FEDAPAY_SECRET_KEY manquant (PAY_MODE=fedapay)');
  return errs;
}

module.exports = { loadConfig, validateConfig };
