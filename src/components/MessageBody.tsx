// Corps d'un message de la messagerie DN. Les notifications automatiques arrivent en
// HTML (<p>, <strong>, <a>…) ; les messages des usagers en texte. Le HTML n'est jamais
// injecté tel quel : DOMParser le lit sans rien exécuter, puis seules les balises de
// ALLOWED sont recréées en React. Le reste est rendu comme texte.
import { Fragment, type ReactNode } from "react";

const ALLOWED: Record<string, string> = {
  P: "p", BR: "br", STRONG: "strong", B: "strong", EM: "em", I: "em",
  UL: "ul", OL: "ol", LI: "li", A: "a",
};

const looksLikeHtml = (s: string) => /<\/?(p|br|strong|b|em|i|a|ul|ol|li|div)\b/i.test(s);

function safeHref(href: string | null) {
  try {
    const url = new URL(href ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function convert(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const children = Array.from(el.childNodes, convert);
  const tag = ALLOWED[el.tagName];
  if (!tag) return <Fragment key={key}>{children}</Fragment>;
  if (tag === "br") return <br key={key} />;
  if (tag === "a") {
    const href = safeHref(el.getAttribute("href"));
    return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <Fragment key={key}>{children}</Fragment>;
  }
  const Tag = tag as "p";
  return <Tag key={key}>{children}</Tag>;
}

export function MessageBody({ body }: { body: string }) {
  if (!looksLikeHtml(body)) return <div className="message__body message__body--text">{body}</div>;

  const doc = new DOMParser().parseFromString(body, "text/html");
  // Les notifications commencent par « [Objet de l'e-mail] » dans un premier <p>.
  let subject: string | null = null;
  const first = doc.body.firstElementChild;
  const match = first?.tagName === "P" && first.textContent?.trim().match(/^\[(.+)\]$/s);
  if (match) {
    subject = match[1].trim();
    first.remove();
  }
  return (
    <div className="message__body">
      {subject && <p className="message__subject">{subject}</p>}
      {Array.from(doc.body.childNodes, convert)}
    </div>
  );
}
