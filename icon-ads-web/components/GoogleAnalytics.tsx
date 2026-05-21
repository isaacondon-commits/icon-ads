'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function GoogleAnalytics() {
  const [measId, setMeasId] = useState('');

  useEffect(() => {
    api.getSettings().then((s) => setMeasId(s['ga_measurement_id'] ?? '')).catch(() => {});
  }, []);

  useEffect(() => {
    if (!measId || document.getElementById('gtag-script')) return;
    const s1 = document.createElement('script');
    s1.id = 'gtag-script';
    s1.async = true;
    s1.src = `https://www.googletagmanager.com/gtag/js?id=${measId}`;
    document.head.appendChild(s1);
    const s2 = document.createElement('script');
    s2.id = 'gtag-init';
    s2.text = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${measId}');`;
    document.head.appendChild(s2);
  }, [measId]);

  return null;
}
