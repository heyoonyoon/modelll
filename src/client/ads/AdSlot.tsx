/**
 * ERD 칸 오른쪽, 미니맵 바로 위에 고정되는 광고 칸 하나(구글 애드센스).
 *
 * 광고 단위 ID는 빌드할 때 넣는다(VITE_ADSENSE_SLOT). 승인 뒤 애드센스에서 만든 디스플레이 광고 단위의 ID다.
 * 값이 없으면 운영 화면에는 아무것도 그리지 않고, 개발 서버에서만 자리 표시를 그려 위치를 확인할 수 있게 한다.
 *
 * VITE_ADS_ROTATE=1 이면 사용자가 다른 창에 갔다가 돌아올 때 광고를 새로 불러온다(최소 ROTATE_GAP_MS 간격).
 * 기본은 꺼져 있다. 애드센스 승인 심사 중에는 켜지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import './AdSlot.css';

/** 게시자 ID(공개 값). 광고 스크립트는 index.html의 <head>에서 이미 불러온다 */
export const ADSENSE_CLIENT = 'ca-pub-6945008026146161';
const CLIENT = (import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) || ADSENSE_CLIENT;
const SLOT = (import.meta.env.VITE_ADSENSE_SLOT as string | undefined) ?? '';
/** 첫 화면 양옆 광고 단위. 따로 만들지 않았으면 방 화면 광고 단위를 같이 쓴다 */
const SLOT_HOME = (import.meta.env.VITE_ADSENSE_SLOT_HOME as string | undefined) || SLOT;
const ROTATE = import.meta.env.VITE_ADS_ROTATE === '1';
/** 다시 볼 때 새로 불러오는 최소 간격 */
export const ROTATE_GAP_MS = 30_000;
const SHOW_PLACEHOLDER = (import.meta.env.DEV || import.meta.env.VITE_ADS_PLACEHOLDER === '1') && import.meta.env.MODE !== 'test';

export const ADS_ENABLED = Boolean(CLIENT && SLOT) || SHOW_PLACEHOLDER;

/**
 * 광고 칸 높이(px). 표준 크기만 쓴다(표준이 아니면 들어올 광고가 적다).
 * 600이면 160×600(와이드 스카이스크래퍼), 240이면 120×240(세로 배너), 0이면 그리지 않는다
 */
export function adHeight(paneHeight: number, minimap: boolean): number {
  if (!ADS_ENABLED || !(paneHeight > 0)) return 0;
  // 위의 패널(속성 패널, 다이어그램 패널)이 쓸 높이를 최소 300px 남긴다
  const reserved = 12 + 300 + 8 + (minimap ? 104 : 12);
  if (paneHeight - reserved >= 600) return 600;
  if (paneHeight - reserved >= 240) return 240;
  return 0;
}

let scriptLoaded = false;
function loadScript(): void {
  if (scriptLoaded || !CLIENT) return;
  scriptLoaded = true;
  if (document.querySelector('script[src*="adsbygoogle.js"]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT)}`;
  document.head.appendChild(s);
}

type AdsQueue = { push(v: object): void };

/** 높이에 맞는 표준 광고 폭 */
export function adWidth(height: number): number {
  return height >= 600 ? 160 : 120;
}

/** 다른 창에서 돌아올 때마다 바뀌는 번호(간격 제한 포함). 끄면 늘 0 */
function useRotation(): number {
  const [n, setN] = useState(0);
  const last = useRef(Date.now());
  useEffect(() => {
    if (!ROTATE) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last.current < ROTATE_GAP_MS) return;
      last.current = now;
      setN((v) => v + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return n;
}

function AdUnit({ height, slot = SLOT }: { height: number; slot?: string }) {
  useEffect(() => {
    loadScript();
    try {
      const w = window as unknown as { adsbygoogle?: AdsQueue | object[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch {
      // 광고 차단기 등으로 실패해도 화면은 그대로 둔다
    }
  }, []);
  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'inline-block', width: adWidth(height), height }}
      data-ad-client={CLIENT}
      data-ad-slot={slot}
    />
  );
}

export function AdSlot({ height }: { height: number }) {
  const round = useRotation();
  if (height <= 0) return null;
  return (
    <div className="ad-slot" data-testid="ad-slot" style={{ height }}>
      {CLIENT && SLOT ? (
        // 번호가 바뀌면 <ins>를 새로 만들어 새 광고를 받는다
        <AdUnit key={`${round}-${height}`} height={height} />
      ) : (
        <div className="ad-slot-placeholder" style={{ width: adWidth(height) }}>
          AD {adWidth(height)}×{height}
        </div>
      )}
    </div>
  );
}

/** 첫 화면 양옆에 세우는 160×600 광고. 넓은 화면에서만 그린다(Home.tsx) */
export const HOME_RAILS_ENABLED = Boolean(CLIENT && SLOT_HOME) || SHOW_PLACEHOLDER;

export function RailAd({ side }: { side: 'left' | 'right' }) {
  const round = useRotation();
  return (
    <div className={`home-rail home-rail-${side}`} data-testid={`home-rail-${side}`}>
      {CLIENT && SLOT_HOME ? (
        <AdUnit key={round} height={600} slot={SLOT_HOME} />
      ) : (
        <div className="ad-slot-placeholder" style={{ width: 160, height: 600 }}>
          AD 160×600
        </div>
      )}
    </div>
  );
}
