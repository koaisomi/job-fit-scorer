# Job Fit Scorer

A Chrome/Edge extension (Manifest V3) that scores any job post against your resume. It gives you a fit score, a breakdown, gaps, resume suggestions you can paste, and a check on whether the company and post look genuine. It can also write a targeted resume and cover letter for the job.

Plain HTML, CSS and JavaScript. No build step, no npm packages, nothing loaded from a CDN. One vendored library: pdf.js (see Third-party code).

## AI engines (Settings > AI engine)

| Engine | Cost | How it works |
| --- | --- | --- |
| **Free – Paste into your AI chat** (default) | Free | Start Scoring copies one prompt and opens your chat site (claude.ai, ChatGPT or Gemini, picked under **Chat site**). Paste the prompt there with Ctrl+V and send it, copy the whole reply, and paste it back in the panel. The panel reads the reply and shows the normal results. Generating a resume or cover letter works the same way. |
| **Free – Quick check (no AI, instant)** | Free | Runs on this device with rules: job facts from the page, keyword match against a built-in skill list, years of experience, education level, location and work setup, and scam warning signs. Rougher than AI. Writing a resume or cover letter uses the chat handoff. |
| **Claude API key** | Paid per use | Sends your resume and the page to the Claude API with your own key. Model and effort settings apply. |

Each result shows which engine made it ("via claude.ai chat", "Quick check", "Claude API").

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder (`job-fit-scorer`). Updating from 1.1? Click the reload icon on the extension's card instead.
4. Pin the extension so its icon shows in the toolbar.

Needs Chrome or Edge 116 or newer (the browser side panel). The browser asks once to "read and change all your data on all websites": the panel needs it to read the job page in whichever tab you switch to. It reads a page only when the panel is open on it.

No API key is needed for the free engines. For the Claude API engine, get a key at [console.anthropic.com](https://console.anthropic.com) (Settings > API keys).

## Use

1. Click the toolbar icon or press **Alt+J**. The panel opens in the browser's own side panel, beside the page (the page narrows; nothing covers it). Drag the panel's edge to resize it. Close it with the browser's side panel close button.
2. Optional: open **Settings** (gear icon) to pick the AI engine and chat site. The default, **Free – Paste into your AI chat**, needs no key. For the Claude API engine, paste your key and pick a model and effort.
3. Attach your resume once: drop a PDF, DOCX, TXT or MD file, or paste the text. The text of a PDF is read on this device for the free engines; a scanned (image-only) PDF has no text, so paste the text or use a DOCX instead.
4. Open a job post (LinkedIn, Indeed, JobStreet, OnlineJobs.ph, Upwork, a company careers page) and click **Start Scoring**. With the chat engine, follow the three steps in the panel: paste the prompt in the chat, copy the whole reply, paste it back and click **Show results**. If the reply cannot be read, ask the chat "Reply with only the JSON code block" and paste again. Tip: if the page is cluttered, select the job description first; a selection over 200 characters is used as the post.
5. From the results you can:
   - **Download** the report as PDF, Word, text, Markdown or HTML.
   - **I'll Apply Now** to generate a targeted resume and/or cover letter.
   - **Save** the job to your list on the main view.
   - Copy the whole report (icon at the top right of the score card) or single resume suggestions.

The last result for each job is kept, so reopening the panel on the same post shows it again. Jobs are matched by a stable job ID where the site has one (LinkedIn job ID, Indeed `jk`, JobStreet job ID, OnlineJobs.ph job ID), otherwise by the page's canonical link or its URL without tracking parameters. Click **Rescore** to run it again.

The panel stays open as you move between tabs and pages in the window. It always reads the tab in front: switch tabs or click another job in a LinkedIn or JobStreet list and the "This page" card updates. While you are on results, the apply screen or the paste screen, the panel keeps the job you scored, so you can switch to the chat tab and back freely.

Because the panel is part of the browser, not the web page, the job site cannot take focus away from it: typing and pasting in the panel work on every site.

To change the shortcut, open `chrome://extensions/shortcuts`.

## Privacy

- Your API key, resume, results, saved jobs and settings are stored only in this browser (`chrome.storage.local`). Nothing is kept in `chrome.storage.sync`. Web pages cannot read any of it.
- The extension adds nothing to web pages. When the panel needs the page, it runs a short read-only script in the tab in front (`content.js`) that returns the page text, title, job data and your selection, then ends. It leaves no code or listeners behind and never receives your key or resume.
- Site access ("all websites") is used only for that read, and only while the panel is open.
- Claude API engine: when you click Start Scoring or Generate, your resume and the text of the open page are sent to the Anthropic API (`api.anthropic.com`) and nowhere else.
- Chat engine: the extension sends nothing itself. It copies the prompt (your resume and the page text) to your clipboard and opens the chat site; you decide whether to paste and send it there, under that site's own privacy terms.
- Quick check: everything runs in this browser. Nothing is sent anywhere.
- No other service is contacted (site icons come from the page itself, not a favicon service).
- Your API key stays in this browser's local extension storage. Anyone with access to this browser profile can read it.
- Nothing is sent until you click a button.

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Toolbar click and Alt+J open the side panel |
| `content.js` | Page reader, injected on demand by the panel (job text, job key, JSON-LD, icon, selection) |
| `panel.html`, `panel.css`, `panel.js` | The side panel UI; follows the window's active tab |
| `lib/api.js` | Claude Messages API call, retries and errors |
| `lib/prompts.js` | System prompts and JSON schemas |
| `lib/resume.js` | Resume reading, including a small DOCX (zip) reader |
| `lib/export.js` | Report text and PDF, DOCX, TXT, MD, HTML writers |
| `lib/storage.js` | Storage helpers |
| `lib/handoff.js` | Free chat engine: prompts, reply parsing, result normalising |
| `lib/quick.js` | Free Quick check engine: rules, skill dictionary, scam signs |
| `lib/vendor/pdf.min.mjs`, `lib/vendor/pdf.worker.min.mjs` | pdf.js, reads the text of PDF resumes |
| `scripts/make-icons.mjs` | Regenerates `icons/*.png` (score gauge) via the shared `../make-icons.mjs` |

## Known limits

- Pages the browser protects (`chrome://`, the Web Store, PDF viewer) cannot be read.
- Pages that load the job inside an iframe from another site may give only partial text; select the job text first in that case.
- PDF export uses the standard Helvetica font, so characters outside Western European text (emoji, Chinese, Thai) show as `?`. Use Word or HTML export for those.
- Scanned (image-only) PDF resumes work only with the Claude API engine (Claude reads the scan); the free engines need a text PDF, DOCX or pasted text.
- Quick check is a keyword and rules match, not an AI read. On a cluttered page, select the job description first. Its company and location guesses from plain page text can miss; JSON-LD job data (most job boards) is used first.
- The chat engine depends on the chat site's free plan limits. A very long page makes a long prompt; select the job description to keep it short.
- The pending chat step lives in the open panel. Closing the side panel while you wait for the reply loses it; click Start Scoring again.
- On a search list page (for example JobStreet "Jobs in Philippines" with a job selected) the page title is the search title, so the card and a Quick check result may show it instead of the job title. The job is still told apart by its job ID. Open the job's own page, or select the job description, for the cleanest result.
- LinkedIn and OnlineJobs.ph are read from the job itself (LinkedIn job pane or job page, OnlineJobs.ph job page), not the whole page. When the browser window is narrow (about 1000 px of page beside the panel), LinkedIn hides the job pane on search pages, so the list is read instead; click the job to open its own page.

## Third-party code

- pdf.js 4.10.38 (`pdfjs-dist`, legacy build, released 2025-01-01), Copyright Mozilla Foundation, Apache License 2.0. Files: `lib/vendor/pdf.min.mjs`, `lib/vendor/pdf.worker.min.mjs`, unmodified from the npm package.
