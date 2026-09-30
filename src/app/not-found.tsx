import Trouble from '@/components/Trouble';

/** 無い場所を開いた時。古いリンクを踏んだ人が、ここに来る。 */
export default function NotFound() {
  return (
    <Trouble
      title="このページはありません"
      lead="アドレスが変わったか、古いリンクかもしれません。最初の画面から、いつも通り使えます。"
      source="not-found"
    />
  );
}
