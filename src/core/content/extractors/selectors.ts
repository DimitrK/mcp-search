export const HEADING_SELECTORS = 'h1, h2, h3, h4, h5, h6, .heading, .title, [role="heading"]';

export const CONTENT_SELECTORS =
  'article, main, [role="main"], .post-content, .entry-content, .content, #content';

export const NOISE_SELECTORS =
  'nav, aside, footer, dialog, .modal, .nav, .menu, .breadcrumb, .sidebar, .footer, .header, .promo, .subscribe, .cookie, .gdpr, .ad, .advertisement';

export const PAGE_HEADER_SELECTORS = 'body > header, .site-header, .page-header, .masthead';

export const MULTIMEDIA_SELECTORS =
  'img, video, audio, embed, object, iframe, svg, canvas, picture, source, track, map, area';

export const STYLE_SELECTORS = 'style, link[rel="stylesheet"]';

export const SCRIPT_SELECTORS = 'script, noscript';

export const FORM_SELECTORS = 'input, select, option, optgroup, datalist, output, progress, meter';

export const METADATA_SELECTORS = 'head, meta, base, link:not([rel="stylesheet"])';

export const TEMPLATE_SELECTORS = 'template, slot';

export const DEPRECATED_VISUAL_SELECTORS =
  'marquee, frame, frameset, noframes, blink, font[color], font[size], center';

// Combined selector for all non-textual content
export const ALL_NON_TEXTUAL_SELECTORS = [
  MULTIMEDIA_SELECTORS,
  SCRIPT_SELECTORS,
  FORM_SELECTORS,
  METADATA_SELECTORS,
  TEMPLATE_SELECTORS,
  DEPRECATED_VISUAL_SELECTORS,
].join(', ');
