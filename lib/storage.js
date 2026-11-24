// Storage wrappers. Key, resume, results and saved jobs stay in storage.local (this browser only).
const local = chrome.storage.local;

export const DEFAULTS = { engine: 'handoff', chatSite: 'claude', apiKey: '', model: 'claude-opus-5-5', effort: 'medium' };

export async function getSettings() {
  return { ...DEFAULTS, ...(await local.get(Object.keys(DEFAULTS))) };
}
export const setSetting = (key, value) => local.set({ [key]: value });

export async function getResume() {
  return (await local.get('resume')).resume || null;
}
export const setResume = (resume) => local.set({ resume });
export const removeResume = () => local.remove('resume');

// Last result per cleaned job URL.
const resultKey = (url) => 'result:' + url;
export async function getResult(url) {
  return (await local.get(resultKey(url)))[resultKey(url)] || null;
}
export const setResult = (url, entry) => local.set({ [resultKey(url)]: entry });

export async function getSaved() {
  return (await local.get('savedJobs')).savedJobs || [];
}
export async function saveJob(job) {
  const list = (await getSaved()).filter((j) => j.url !== job.url);
  list.unshift(job);
  await local.set({ savedJobs: list });
  return list;
}
export async function removeJob(url) {
  const list = (await getSaved()).filter((j) => j.url !== url);
  await local.set({ savedJobs: list });
  return list;
}
