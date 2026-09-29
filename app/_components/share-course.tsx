"use client";

import { useState } from "react";

/** コースのリンクを共有する。スマホでは共有メニュー、それ以外ではリンクをコピーする。 */
export default function ShareCourse({ path, title }: { path: string; title: string }) {
  const [message, setMessage] = useState("");

  async function share() {
    const url = `${window.location.origin}${window.location.pathname}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title}｜まちぽ`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage("リンクをコピーしました");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("共有できませんでした。アドレスバーのリンクをコピーしてください。");
    }
    window.setTimeout(() => setMessage(""), 3000);
  }

  return <div className="share-course">
    <button type="button" className="secondary-button" onClick={() => void share()}>このコースを共有する</button>
    {message ? <span role="status">{message}</span> : null}
  </div>;
}
