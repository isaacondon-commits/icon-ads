'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// La lista de tablets vive en el Monitor (tiene todo lo que tenía esta página:
// acciones por tablet, sincronizar todas, CSV, alta manual y filtros por
// playlist/zona). Esta ruta queda sólo para que los links/marcadores viejos a
// /tablets sigan funcionando. El detalle (/tablets/[id]) y Comparar
// (/tablets/compare) siguen igual.
export default function TabletsRedirect() {
  const router = useRouter();
  useEffect(() => {
    const nueva = new URLSearchParams(window.location.search).get('nueva') === '1';
    router.replace(nueva ? '/monitor?nueva=1' : '/monitor');
  }, [router]);
  return <p className="text-sm text-[var(--muted)]">Abriendo el Monitor…</p>;
}
