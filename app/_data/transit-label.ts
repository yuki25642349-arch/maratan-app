// 区間の移動手段を「徒歩」「バス」「電車」と分かりやすく表示するための共通処理（ブラウザ・サーバー共用）。

export type TransitKind = "bus" | "train" | "mixed";
export type LegMode = "walking" | "transit";
export type LegOption = { mode: LegMode; minutes: number; transitKind: TransitKind | null };

const BUS_TYPES = new Set(["BUS", "INTERCITY_BUS", "TROLLEYBUS", "SHARE_TAXI"]);

/** 乗った乗り物の種類（Google Routes の vehicle.type）から、バス・電車・両方を判定する。 */
export function transitKindOf(vehicleTypes: readonly string[]): TransitKind | null {
  if (!vehicleTypes.length) return null;
  const bus = vehicleTypes.some((type) => BUS_TYPES.has(type));
  const train = vehicleTypes.some((type) => !BUS_TYPES.has(type));
  return bus && train ? "mixed" : bus ? "bus" : "train";
}

export function modeLabel(mode: LegMode, kind: TransitKind | null | undefined) {
  if (mode === "walking") return "徒歩";
  return kind === "bus" ? "バス" : kind === "train" ? "電車" : "電車・バス";
}

/** 「徒歩 約8分」「バスで約12分」 */
export function legText(option: Pick<LegOption, "mode" | "minutes" | "transitKind">) {
  return option.mode === "walking" ? `徒歩 約${option.minutes}分` : `${modeLabel(option.mode, option.transitKind)}で約${option.minutes}分`;
}

/**
 * もう一方の移動手段も見せるかどうか。徒歩が長い区間ではバス・電車を、
 * バス・電車を選んだ区間では徒歩の分数を、比べられるように出す。
 */
export function showAlternative(chosen: LegOption, alternative: LegOption | null | undefined) {
  if (!alternative || alternative.mode === chosen.mode) return false;
  return chosen.mode === "transit" ? alternative.minutes <= 60 : chosen.minutes >= 15;
}

/** 速いほうを選ぶ。ほぼ同じ（3分以内）なら、待ち時間の読めない乗り物より徒歩を選ぶ。 */
export function chooseLeg<T extends LegOption>(walking: T | null, transit: T | null): { chosen: T; alternative: T | null } | null {
  if (walking && transit) return transit.minutes + 3 < walking.minutes ? { chosen: transit, alternative: walking } : { chosen: walking, alternative: transit };
  const only = walking ?? transit;
  return only ? { chosen: only, alternative: null } : null;
}
