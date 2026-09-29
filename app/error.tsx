"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="not-found-page">
    <h1>うまく表示できませんでした</h1>
    <p>通信状況を確認して、もう一度お試しください。続く場合は時間をおいてから開き直してください。</p>
    <button className="primary-button" type="button" onClick={reset}>もう一度読み込む</button>
  </main>;
}
