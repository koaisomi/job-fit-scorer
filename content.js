// Job Fit Scorer page extraction. The side panel injects this file on demand with
// chrome.scripting.executeScript; the value of the last expression (the page data) is the injection result.
// It adds no listeners and leaves nothing behind on the page.
(() => {
  const TRACKING = /^(utm_.*|gclid|gad_.*|fbclid|msclkid|gbraid|wbraid)$/i;

  function cleanUrl(href) {
    try {
      const u = new URL(href);
      for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
      return u.toString();
    } catch {
      return href;
    }
  }

  const SEARCH_PARAMS = ['q', 'query', 'keywords', 'keyword', 'k', 'what', 'search'];
  const isSearchPage = (u) => /(^|\/)(search|results|jobs-in-|find-jobs)/i.test(u.pathname) || SEARCH_PARAMS.some((p) => u.searchParams.has(p));

  // One stable key per job: dedupe and result cache use it.
  function jobKey() {
    const u = new URL(cleanUrl(location.href));
    const host = u.hostname.replace(/^www\./, '');
    if (/(^|\.)linkedin\.com$/.test(host)) {
      // Guest job pages put a slug before the ID: /jobs/view/virtual-assistant-at-acme-4483073584
      const id = u.searchParams.get('currentJobId') || u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    if (/(^|\.)onlinejobs\.ph$/.test(host)) {
      const id = u.pathname.match(/\/jobseekers\/job\/(?:[^/]*-)?(\d+)/)?.[1];
      if (id) return `https://www.onlinejobs.ph/jobseekers/job/${id}`;
    }
    if (/(^|\.)indeed\./.test(host)) {
      const jk = u.searchParams.get('jk') || u.searchParams.get('vjk');
      if (jk) return `https://${u.hostname}/viewjob?jk=${encodeURIComponent(jk)}`;
    }
    if (/(^|\.)jobstreet\./.test(host)) {
      const id = u.searchParams.get('jobId') || u.pathname.match(/\/job\/(\d+)/)?.[1];
      if (id) return `https://${u.hostname}/job/${encodeURIComponent(id)}`;
    }
    const canon = document.querySelector('link[rel="canonical"]')?.href;
    if (canon && !isSearchPage(u)) {
      try {
        const c = new URL(canon);
        if (c.hostname.replace(/^www\./, '') === host && c.pathname !== '/') return cleanUrl(c.href);
      } catch {}
    }
    return u.toString();
  }

  const tidy = (s) => String(s || '').replace(/[^\S\n]+/g, ' ').replace(/ *\n\s*/g, '\n').trim();
  const txt = (root, sel) => tidy(root.querySelector(sel)?.innerText);

  // Site job panes: the job itself instead of the whole page (lists, nav, sign-in walls, similar jobs).
  // Returns { name, title, text }; { name } alone (no job on screen) or null keeps the generic page text.
  function siteJob() {
    const host = location.hostname;
    if (/(^|\.)linkedin\.com$/.test(host)) {
      // Guest search shows the selected job in .details-pane__content; guest job pages have the same top card.
      // The job-details-* / #job-details selectors are the signed-in layout.
      const root = document.querySelector('.details-pane__content') || document;
      const title = txt(root, '.top-card-layout__title, .job-details-jobs-unified-top-card__job-title');
      const desc = txt(root, '.description__text .show-more-less-html__markup, .jobs-description__content, #job-details');
      if (!title || !desc) return { name: 'LinkedIn' };
      const lines = [title, txt(root, '.topcard__org-name-link, .job-details-jobs-unified-top-card__company-name'), txt(root, '.topcard__flavor--bullet'), txt(root, '.posted-time-ago__text'), txt(root, '.compensation__salary'), desc, txt(root, '.description__job-criteria-list')];
      return { name: 'LinkedIn', title, text: lines.filter(Boolean).join('\n') };
    }
    if (/(^|\.)onlinejobs\.ph$/.test(host)) {
      // Job page: employer (h3.job__logo, only when the employer shows it), h1, facts, description, skills.
      const title = /\/jobseekers\/job\//.test(location.pathname) && txt(document, 'h1');
      const body = tidy(document.body?.innerText);
      const i = title ? body.indexOf(title + '\n') : -1;
      if (i < 0 || !document.querySelector('#job-description')) return { name: 'OnlineJobs.ph' };
      let t = body.slice(i + title.length + 1).split(/\nSHARE THIS POST\b/)[0].replace(/^Please login or register\b.*\n/im, '');
      const upd = t.match(/^DATE UPDATED\n(.+)\n/m);
      if (upd) t = t.replace(upd[0], '');
      t = t.replace(/^(TYPE OF WORK|WAGE \/ SALARY|HOURS PER WEEK)\n/gm, (m, k) => k.charAt(0) + k.slice(1).toLowerCase() + ': ');
      // Title, then employer, then the date: the Quick check reads the company from the line under the title.
      t = [title, txt(document, 'h3.job__logo'), upd && `Updated ${upd[1]}`, t].filter(Boolean).join('\n');
      return { name: 'OnlineJobs.ph', title, text: t };
    }
    return null;
  }

  function siteName() {
    const og = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
    if (og) return og;
    const hostName = location.hostname.replace(/^www\./, '');
    return hostName.charAt(0).toUpperCase() + hostName.slice(1);
  }

  // No third-party favicon service: empty when the page declares none.
  const favicon = () => document.querySelector('link[rel~="icon"]')?.href || '';

  function jobPostings() {
    const out = [];
    const isJob = (o) => {
      const t = o?.['@type'];
      return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
    };
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (isJob(node)) out.push(node);
      if (node['@graph']) walk(node['@graph']);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(s.textContent));
      } catch {}
    }
    return out.length ? JSON.stringify(out).slice(0, 15000) : '';
  }

  function extract() {
    const sel = String(window.getSelection?.() || '').trim();
    const site = siteJob();
    const text = (site?.text || tidy(document.body?.innerText)).slice(0, 40000);
    return {
      url: cleanUrl(location.href),
      key: jobKey(),
      // "Role | Site": the Quick check drops the last " | " part as the site name.
      title: site?.text ? `${site.title} | ${site.name}` : document.title,
      siteName: site?.name || siteName(),
      favicon: favicon(),
      selectionText: sel.length > 200 ? sel.slice(0, 40000) : '',
      jsonLd: jobPostings(),
      text,
    };
  }

  return extract();
})();
