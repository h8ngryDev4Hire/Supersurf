/**
 * Bot detection bypass — temporarily restores native DOM methods
 * Adapted from Blueprint MCP (Apache 2.0)
 */

const WRAPPED_METHODS = [
  'document.querySelector',
  'document.querySelectorAll',
  'document.getElementById',
  'document.getElementsByClassName',
  'document.getElementsByTagName',
  'Element.prototype.querySelector',
  'Element.prototype.querySelectorAll',
  'Element.prototype.getAttribute',
  'Element.prototype.setAttribute',
  'Element.prototype.getBoundingClientRect',
  'window.getComputedStyle',
];

export function shouldUnwrap(code: string): boolean {
  return WRAPPED_METHODS.some((method) => {
    const shortName = method.split('.').pop()!;
    return code.includes(shortName);
  });
}

export function wrapWithUnwrap(userCode: string): string {
  if (!shouldUnwrap(userCode)) return userCode;

  return `
(function() {
  // Save potentially wrapped methods
  const _saved = {};
  const _iframe = document.createElement('iframe');
  _iframe.style.display = 'none';
  document.body.appendChild(_iframe);
  const _nativeDoc = _iframe.contentDocument;
  const _nativeWin = _iframe.contentWindow;

  // Restore native methods
  if (_nativeDoc) {
    _saved.querySelector = document.querySelector;
    document.querySelector = _nativeDoc.querySelector.bind(document);
    _saved.querySelectorAll = document.querySelectorAll;
    document.querySelectorAll = _nativeDoc.querySelectorAll.bind(document);
  }
  if (_nativeWin) {
    _saved.getComputedStyle = window.getComputedStyle;
    window.getComputedStyle = _nativeWin.getComputedStyle.bind(window);
  }

  let result;
  try {
    result = eval(${JSON.stringify(userCode)});
  } finally {
    // Restore wrapped methods
    if (_saved.querySelector) document.querySelector = _saved.querySelector;
    if (_saved.querySelectorAll) document.querySelectorAll = _saved.querySelectorAll;
    if (_saved.getComputedStyle) window.getComputedStyle = _saved.getComputedStyle;
    _iframe.remove();
  }
  return result;
})()
  `.trim();
}
