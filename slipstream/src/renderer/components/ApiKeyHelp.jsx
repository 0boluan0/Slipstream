import React, { useState } from 'react';
import { ArrowSquareOut } from '../phosphorIcons';
import { apiKeyHelpFor } from '../utils/apiKeyHelp.mjs';

// Collapsed by default: readers who already have a key never need it, and
// readers who do not can find the provider's key page without leaving setup.
export default function ApiKeyHelp({ backend, onOpenExternal }) {
  const help = apiKeyHelpFor(backend);
  const [notice, setNotice] = useState('');
  if (!help) return null;

  const open = async (url) => {
    setNotice('');
    try {
      await onOpenExternal(url);
      setNotice('已在浏览器中打开。拿到 Key 后回到这里粘贴。');
    } catch {
      setNotice('暂时无法打开链接，请检查网络后重试。');
    }
  };

  return (
    <details className="api-key-help">
      <summary>还没有 {help.provider} API Key？</summary>
      <ol>
        {help.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <p className="api-key-help__cost">{help.cost}</p>
      <div className="api-key-help__actions">
        <button type="button" onClick={() => open(help.consoleUrl)}>
          <ArrowSquareOut size={14} aria-hidden="true" />
          {help.consoleLabel}
        </button>
        {help.pricingUrl && (
          <button type="button" onClick={() => open(help.pricingUrl)}>
            查看价格
          </button>
        )}
      </div>
      {notice && <p className="api-key-help__notice" role="status">{notice}</p>}
    </details>
  );
}
