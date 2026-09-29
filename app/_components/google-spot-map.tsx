"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { VerifiedSpot } from "../_data/anilist-types";

type MapInstance = { fitBounds: (bounds: unknown, padding?: number) => void; panTo: (center: { lat: number; lng: number }) => void };
type Marker = { map: MapInstance | null; zIndex?: number | null; addListener: (event: string, listener: () => void) => void };
type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
  LatLngBounds: new () => { extend: (point: { lat: number; lng: number }) => void };
  importLibrary: (name: string) => Promise<unknown>;
  marker: {
    AdvancedMarkerElement: new (options: Record<string, unknown>) => Marker;
  };
};

let loader: Promise<GoogleMaps> | null = null;

// キーの制限・無効化などで Google マップの認証に失敗したときは、Google が gm_authFailure を呼ぶ。
// そのときは Google のエラー画面を出さず、OpenStreetMap の地図に切り替える。
let authFailed = false;
const authListeners = new Set<() => void>();
function subscribeAuthFailure(listener: () => void) {
  authListeners.add(listener);
  return () => { authListeners.delete(listener); };
}

function loadGoogleMaps(key: string): Promise<GoogleMaps> {
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const existing = (window as unknown as { google?: { maps: GoogleMaps } }).google?.maps;
    if (existing) { resolve(existing); return; }
    const callbackName = "__machipoMapsReady";
    const target = window as unknown as Record<string, unknown>;
    target.gm_authFailure = () => { authFailed = true; for (const listener of authListeners) listener(); };
    target[callbackName] = () => { delete target[callbackName]; resolve((window as unknown as { google: { maps: GoogleMaps } }).google.maps); };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, loading: "async", callback: callbackName, libraries: "marker", v: "weekly", language: "ja" })}`;
    script.async = true;
    script.onerror = () => { delete target[callbackName]; loader = null; reject(new Error("地図を読み込めませんでした。")); };
    document.head.appendChild(script);
  });
  return loader;
}

function pinElement(label: string, name: string) {
  const pin = document.createElement("div");
  pin.className = "map-number-pin";
  pin.textContent = label;
  pin.setAttribute("aria-label", name);
  return pin;
}

const DETOUR_PIN_LABELS: Record<string, string> = { food: "食", shopping: "品", culture: "文", experience: "体" };

function detourPinElement(spot: VerifiedSpot) {
  const pin = document.createElement("div");
  pin.className = "map-detour-pin";
  pin.textContent = DETOUR_PIN_LABELS[spot.category ?? ""] ?? "寄";
  pin.setAttribute("aria-label", `地域の寄り道：${spot.name}`);
  return pin;
}

function highlightMarkers(list: Array<{ id: string; marker: Marker; pin: HTMLElement }>, activeId: string) {
  for (const { id, marker, pin } of list) {
    const active = id === activeId;
    pin.classList.toggle("is-active", active);
    marker.zIndex = active ? 10 : null;
  }
}

export default function GoogleSpotMap({ spots, detours = [], activeId, onSelect, fallback }: {
  spots: VerifiedSpot[];
  detours?: VerifiedSpot[];
  activeId: string;
  onSelect: (id: string) => void;
  fallback: React.ReactNode;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapInstance | null>(null);
  const markers = useRef<Array<{ id: string; marker: Marker; pin: HTMLElement }>>([]);
  const detourMarkers = useRef<Marker[]>([]);
  const mapsApi = useRef<GoogleMaps | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  const activeRef = useRef(activeId);
  const [failed, setFailed] = useState(false);
  const authFailure = useSyncExternalStore(subscribeAuthFailure, () => authFailed, () => false);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;

  useEffect(() => { onSelectRef.current = onSelect; activeRef.current = activeId; }, [onSelect, activeId]);

  useEffect(() => {
    if (!key || !element.current || !spots.length) return;
    let disposed = false;
    void loadGoogleMaps(key).then(async (maps) => {
      await maps.importLibrary("maps");
      await maps.importLibrary("marker");
      if (disposed || !element.current) return;
      mapsApi.current = maps;
      const first = spots[0];
      map.current = new maps.Map(element.current, {
        center: { lat: first.latitude, lng: first.longitude }, zoom: 15,
        mapId: process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID",
        clickableIcons: false, mapTypeControl: false, streetViewControl: false, gestureHandling: "cooperative",
      });
      const bounds = new maps.LatLngBounds();
      markers.current = spots.map((spot, index) => {
        const point = { lat: spot.latitude, lng: spot.longitude };
        bounds.extend(point);
        const pin = pinElement(String(index + 1), spot.name);
        const marker = new maps.marker.AdvancedMarkerElement({ map: map.current, position: point, title: spot.name, content: pin, gmpClickable: true });
        marker.addListener("click", () => onSelectRef.current(spot.id));
        return { id: spot.id, marker, pin };
      });
      highlightMarkers(markers.current, activeRef.current);
      if (spots.length > 1) map.current.fitBounds(bounds, 60);
      setReady(true);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; setReady(false); for (const { marker } of markers.current) marker.map = null; markers.current = []; map.current = null; };
  }, [key, spots]);

  // 地域の寄り道は聖地の番号ピンと区別できる別のピンで重ねる。
  useEffect(() => {
    const maps = mapsApi.current;
    if (!ready || !maps || !map.current) return;
    detourMarkers.current = detours.map((spot) => new maps.marker.AdvancedMarkerElement({
      map: map.current, position: { lat: spot.latitude, lng: spot.longitude }, title: `地域の寄り道：${spot.name}`, content: detourPinElement(spot),
    }));
    return () => { for (const marker of detourMarkers.current) marker.map = null; detourMarkers.current = []; };
  }, [ready, detours]);

  useEffect(() => {
    highlightMarkers(markers.current, activeId);
    const active = spots.find((spot) => spot.id === activeId);
    if (active && map.current) map.current.panTo({ lat: active.latitude, lng: active.longitude });
  }, [activeId, spots]);

  if (!key || failed || authFailure) return <>{fallback}</>;
  return <div ref={element} className="google-spot-map" role="region" aria-label="聖地の地図。番号は下の一覧と対応しています。「食」「文」などのピンは地域の寄り道です。" />;
}
