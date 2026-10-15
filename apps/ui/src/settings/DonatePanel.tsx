import { useState } from "react";
import { PIX_PAYLOAD, PIX_QR_PATH, PIX_QR_VIEWBOX } from "./donate-qr";

/** Pix donation at the foot of the settings: a QR and the copy-and-paste code. Offline; nothing leaves the machine. */
export function DonatePanel() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(PIX_PAYLOAD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission: the QR is still there.
    }
  }

  return (
    <details className="donate">
      <summary>Pix do Café</summary>
      <p>
        O 8n8 é livre e gratuito. Se ele ajuda você, pode apoiar com um Pix.
      </p>
      <svg
        className="donate-qr"
        viewBox={PIX_QR_VIEWBOX}
        shapeRendering="crispEdges"
        role="img"
        aria-label="QR Code Pix para doação"
      >
        <rect width="57" height="57" fill="#fff" />
        <path fill="#1e1b4b" d={PIX_QR_PATH} />
      </svg>
      <button type="button" className="btn-ghost" onClick={copy}>
        {copied ? "Código copiado" : "Copiar código Pix"}
      </button>
    </details>
  );
}
