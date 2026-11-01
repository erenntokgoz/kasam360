export function JsonLd({ data }: { data: object }) {
  // Metin içindeki "<" etiket kapatamasın diye kaçırılır.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
