import Link from "next/link";

export default function NotFound() {
  return <main className="not-found-page">
    <h1>ページが見つかりませんでした</h1>
    <p>URL が間違っているか、ページが移動した可能性があります。作品一覧から探し直してください。</p>
    <Link className="primary-button" href="/">作品一覧へ</Link>
  </main>;
}
