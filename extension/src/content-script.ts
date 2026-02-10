/**
 * Content script — tech stack detection + console message relay
 * Adapted from Blueprint MCP (Apache 2.0) — stripped of OAuth token watching
 */

// Listen for console messages from injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data?.__supersurfConsole) {
    const message = event.data.__supersurfConsole;
    chrome.runtime.sendMessage({
      type: 'console',
      level: message.level,
      text: message.text,
      timestamp: message.timestamp,
    });
  }
});

/**
 * Tech stack detection
 */
function detectTechStack(): any {
  const stack: any = {
    frameworks: [],
    libraries: [],
    css: [],
    devTools: [],
    spa: false,
    autoReload: false,
    obfuscatedCSS: false,
  };

  try {
    // JS Frameworks
    if (
      (window as any).React ||
      (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
      document.getElementById('root') ||
      document.getElementById('react-root')
    ) {
      stack.frameworks.push('React');
      stack.spa = true;
    }
    if ((window as any).Vue || (window as any).__VUE__ || (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__) {
      stack.frameworks.push('Vue');
      stack.spa = true;
    }
    if ((window as any).ng || document.querySelector('[ng-app]') || document.querySelector('[ng-controller]')) {
      stack.frameworks.push('Angular');
      stack.spa = true;
    }
    if ((window as any).__SVELTE_HMR) {
      stack.frameworks.push('Svelte');
      stack.spa = true;
    }
    if ((window as any).__NEXT_DATA__) {
      stack.frameworks.push('Next.js');
    }
    if ((window as any).__NUXT__) {
      stack.frameworks.push('Nuxt');
    }

    // Libraries
    if ((window as any).jQuery || (window as any).$?.fn?.jquery) {
      stack.libraries.push('jQuery');
    }
    if ((window as any)._ && (window as any)._.VERSION) {
      stack.libraries.push('Lodash');
    }
    if ((window as any).d3) {
      stack.libraries.push('D3.js');
    }
    if ((window as any).Alpine) {
      stack.libraries.push('Alpine.js');
    }
    if ((window as any).htmx) {
      stack.libraries.push('HTMX');
    }

    // CSS Frameworks
    const styleSheets = Array.from(document.styleSheets);
    const allCSS = styleSheets
      .map((s) => {
        try { return s.href || ''; } catch { return ''; }
      })
      .join(' ');

    if (allCSS.includes('bootstrap') || document.querySelector('.container-fluid, .btn-primary')) {
      stack.css.push('Bootstrap');
    }
    if (allCSS.includes('tailwind') || document.querySelector('[class*="flex "], [class*="grid "]')) {
      stack.css.push('Tailwind');
    }
    if (allCSS.includes('bulma') || document.querySelector('.hero.is-primary')) {
      stack.css.push('Bulma');
    }

    // Obfuscated CSS detection
    const elements = document.querySelectorAll('[class]');
    let obfuscatedCount = 0;
    const sample = Math.min(elements.length, 50);
    for (let i = 0; i < sample; i++) {
      const cls = elements[i].className;
      if (typeof cls === 'string' && /^[a-zA-Z]{1,3}[_-][a-zA-Z0-9]{4,8}$/.test(cls.split(' ')[0])) {
        obfuscatedCount++;
      }
    }
    if (obfuscatedCount > sample * 0.3) {
      stack.obfuscatedCSS = true;
    }

    // Dev tools
    if ((window as any).__webpack_require__) stack.devTools.push('Webpack');
    if (document.querySelector('script[type="module"]')) stack.devTools.push('ES Modules');
  } catch {
    // Ignore errors in detection
  }

  return stack;
}

// Run tech stack detection after page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const techStack = detectTechStack();
      chrome.runtime.sendMessage({ type: 'techStack', data: techStack });
    }, 1000);
  });
} else {
  setTimeout(() => {
    const techStack = detectTechStack();
    chrome.runtime.sendMessage({ type: 'techStack', data: techStack });
  }, 1000);
}
