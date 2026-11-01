const APP_NAME = 'Notion Backup Agent';

/** The public pages Google's Branding page requires. Fixed text, so they need no configuration. */
function page(title: string, paragraphs: readonly string[]): Response {
  const body = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body>
<h1>${title}</h1>
${body}
<p><a href="/">Home</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
</body>
</html>
`;

  return new Response(html, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

export function homePage(): Response {
  return page(APP_NAME, [
    `${APP_NAME} is a personal tool, run by its owner for their own account. Once a month it requests the official export of the owner's Notion workspace and stores the ZIP in the owner's Google Drive.`,
    'It is not offered to anyone else.',
  ]);
}

export function privacyPage(): Response {
  return page(`${APP_NAME}: Privacy Policy`, [
    "The app is used only by its owner and accesses only the owner's Google account.",
    "Gmail (<code>gmail.readonly</code>): it finds Notion's export email and reads the download link from it. It stores no email content.",
    'Google Drive (<code>drive.file</code>): it uploads the export ZIP to the backup folder, and reads only files and folders it created or was granted.',
    'The Google refresh token is held as a secret in the hosting environment. Job records hold status and file details, not email content.',
    'Google user data is not sold or used for advertising. Only the providers that run the app process it: Vercel (hosting), Upstash (job records with Gmail message IDs and Drive file details) and Telegram (the backup file name and Drive link, sent to the owner). Google Gemini, which helps diagnose failures, receives content-free context. Use of data from Google APIs follows the Google API Services User Data Policy, including its Limited Use requirements.',
    "To stop all access, remove the app in the Google Account's third-party connections. Questions go to the support email on the Google consent screen.",
  ]);
}

export function termsPage(): Response {
  return page(`${APP_NAME}: Terms`, [
    'This app is a personal tool for its owner. No service is offered to anyone else.',
    'It is provided as is, with no warranty and no guarantee that a backup will succeed.',
    'Questions go to the support email on the Google consent screen.',
  ]);
}
