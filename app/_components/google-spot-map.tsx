"use client";

import { useEffect, useRef, useState } from "react";
import type { VerifiedSpot } from "../_data/anilist-types";

type MapInstance = { fitBounds: (bounds: unknown) => void; setCenter: (center: { lat: number; lng: number }) => void; setZoom: (zoom: number) => void };
type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
  LatLngBounds: new () => { extend: (point: { lat: number; lng: number }) => void };
  importLibrary: (name: string) => Promise<unknown>;
  marker: {
    AdvancedMarkerElement: new (options: Record<string, unknown>) => { map: MapInstance | null };
    PinElement: new (options: Record<string, unknown>) => { element: HTMLElement };
  };
};

let loader: Promise<GoogleMaps> | null = null;

function loadGoogleMaps(key: string): Promise<GoogleMaps> {
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const existing = (window as unknown as { google?: { maps: GoogleMaps } }).google?.maps;
    if (existing) { resolve(existing); return; }
    const callbackName = "__machipoMapsReady";
    const target = window as unknown as Record<string, unknown>;
    target[callbackName] = () => { delete target[callbackName]; resolve((window as unknown as { google: { maps: GoogleMaps } }).google.maps); };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, loading: "async", callback: callbackName, libraries: "marker", v: "weekly", language: "ja" })}`;
    script.async = true;
    script.onerror = () => { delete target[callbackName]; loader = null; reject(new Error("地図を読み込めませんでした。")); };
    document.head.appendChild(script);
  });
  return loader;
}

export default function GoogleSpotMap({ spots, activeId, onSelect, fallback }: {
  spots: VerifiedSpot[];
  activeId: string;
  onSelect: (id: string) => void;
  fallback: React.ReactNode;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapInstance | null>(null);
  const markers = useRef<Array<{ map: MapInstance | null }>>([]);
  const [failed, setFailed] = useState(false);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;

  useEffect(() => {
    if (!key || !element.current) return;
    let disposed = false;
    void loadGoogleMaps(key).then(async (maps) => {
      await maps.importLibrary("maps");
      await maps.importLibrary("marker");
      if (disposed || !element.current) return;
      const active = spots[0];
      map.current = new maps.Map(element.current, { center: { lat: active.latitude, lng: active.longitude }, zoom: 14, mapId: process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID" });
      const bounds = new maps.LatLngBounds();
      markers.current = spots.map((spot) => {
        const point = { lat: spot.latitude, lng: spot.longitude };
        bounds.extend(point);
        const pin = new maps.marker.PinElement({ background: "#f8c2a0", borderColor: "#dd6a22", glyphColor: "#ffffff" });
        const marker = new maps.marker.AdvancedMarkerElement({ map: map.current, position: point, title: spot.name, content: pin.element });
        (marker as unknown as { addListener: (event: string, listener: () => void) => void }).addListener("click", () => onSelect(spot.id));
        return marker;
      });
      if (spots.length > 1) map.current.fitBounds(bounds);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; for (const marker of markers.current) marker.map = null; markers.current = []; map.current = null; };
  }, [key, spots, onSelect]);

  useEffect(() => {
    const active = spots.find((spot) => spot.id === activeId);
    if (active && map.current) { map.current.setCenter({ lat: active.latitude, lng: active.longitude }); map.current.setZoom(15); }
  }, [activeId, spots]);

  if (!key || failed) return <>{fallback}</>;
  return <div ref={element} className="google-spot-map" role="img" aria-label="確認済み聖地の地図。地点リストからも選択できます。" />;
}
