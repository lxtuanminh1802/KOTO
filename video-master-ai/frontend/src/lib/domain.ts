import type { Detection, Modes } from './types'

export const COLORS: Record<string, { hex: string; vi: string; en: string }> = {
  white: { hex: '#F8FAFC', vi: 'trắng', en: 'white' }, black: { hex: '#111111', vi: 'đen', en: 'black' }, silver: { hex: '#C0C4CC', vi: 'bạc', en: 'silver' },
  gray: { hex: '#6B7280', vi: 'xám', en: 'grey' }, brown: { hex: '#8B5A3C', vi: 'nâu', en: 'brown' }, beige: { hex: '#E9DFC7', vi: 'be', en: 'beige' },
  pink: { hex: '#F2A7C3', vi: 'hồng', en: 'pink' }, red: { hex: '#D94141', vi: 'đỏ', en: 'red' }, orange: { hex: '#E8762B', vi: 'cam', en: 'orange' },
  yellow: { hex: '#F2C230', vi: 'vàng', en: 'yellow' }, green: { hex: '#2E8B57', vi: 'xanh lá', en: 'green' }, cyan: { hex: '#39B5C8', vi: 'xanh ngọc', en: 'cyan' },
  blue: { hex: '#2F5BEA', vi: 'xanh dương', en: 'blue' }, purple: { hex: '#7B4FD1', vi: 'tím', en: 'purple' },
}
export const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'black']
export const colorName = (k: string | undefined, lang: 'vi' | 'en') => (k && COLORS[k] ? COLORS[k][lang] : k || '')

export const FPS_OPTS: [string, string, string, number, string, string][] = [
  ['all', 'Phân tích toàn bộ', 'Every frame', 25, 'Chính xác nhất, chậm nhất. Dùng khi cần bắt đối tượng xuất hiện rất nhanh.', 'Most accurate, slowest. Use when subjects pass very quickly.'],
  ['10', '10 FPS (1s 10 hình)', '10 FPS (10 frames/s)', 10, 'Bắt tốt người và xe di chuyển nhanh. Chậm gấp đôi 5 FPS.', 'Catches fast-moving people and vehicles. Twice as slow as 5 FPS.'],
  ['5', '5 FPS (1s 5 hình)', '5 FPS (5 frames/s)', 5, 'Khuyên dùng: cân bằng giữa tốc độ và độ chính xác cho camera giám sát.', 'Recommended: balances speed and accuracy for CCTV.'],
  ['2', '2 FPS (1s 2 hình)', '2 FPS (2 frames/s)', 2, 'Nhanh hơn, hợp với cảnh ít chuyển động, camera cố định.', 'Faster; suits static cameras with little motion.'],
  ['1', '1 FPS (1s 1 hình)', '1 FPS (1 frame/s)', 1, 'Nhanh hơn, hợp với cảnh ít chuyển động, camera cố định.', 'Faster; suits static cameras with little motion.'],
  ['0.5', '0.5 FPS (2s 1 hình)', '0.5 FPS (1 frame / 2 s)', 0.5, 'Rất nhanh, có thể bỏ sót đối tượng đi ngang nhanh. Dùng để rà soát video dài.', 'Very fast; may miss quick passers-by. For skimming long recordings.'],
  ['0.2', '0.2 FPS (5s 1 hình)', '0.2 FPS (1 frame / 5 s)', 0.2, 'Rất nhanh, có thể bỏ sót đối tượng đi ngang nhanh. Dùng để rà soát video dài.', 'Very fast; may miss quick passers-by. For skimming long recordings.'],
]
export const fpsOf = (k: string) => FPS_OPTS.find(o => o[0] === k) || FPS_OPTS[2]

export const MODE_GROUPS: { k: 'person' | 'vehicle'; icon: string; vi: string; en: string; subs: [string, string, string][] }[] = [
  { k: 'person', icon: 'user', vi: 'Con người', en: 'People', subs: [['gait', 'Dáng người', 'Gait'], ['attr', 'Đặc điểm (trang phục, màu sắc)', 'Attributes (clothing, colour)'], ['face', 'Khuôn mặt', 'Faces'], ['mask', 'Khẩu trang', 'Face mask']] },
  { k: 'vehicle', icon: 'car', vi: 'Phương tiện', en: 'Vehicles', subs: [['color', 'Màu sắc', 'Colour'], ['plate', 'Hình ảnh biển số', 'Licence plate']] },
]
export const defaultModes = (): Modes => ({ person: { gait: true, attr: true, face: true, mask: true }, vehicle: { color: true, plate: true } })
export const modeCount = (m: Modes) => Object.values(m).reduce((a, g) => a + Object.values(g).filter(Boolean).length, 0)

export const SOURCES: [string, string, string][] = [
  ['NVR', 'Đầu ghi camera (NVR/DVR)', 'Camera recorder (NVR/DVR)'],
  ['TRAFFIC', 'Camera giao thông', 'Traffic camera'],
  ['PHONE', 'Điện thoại, nhân chứng cung cấp', 'Phone, from a witness'],
  ['OTHER', 'Nguồn khác', 'Other source'],
]

export const FILTER_GROUPS: { k: 'gender' | 'top' | 'bottom' | 'mask' | 'acc'; label: string; opts: [string, string][] }[] = [
  { k: 'gender', label: 'fGender', opts: [['m', 'male'], ['f', 'female']] },
  { k: 'top', label: 'fTop', opts: [['long', 'long'], ['short', 'short']] },
  { k: 'bottom', label: 'fBottom', opts: [['pants', 'pants'], ['shorts', 'shorts'], ['skirt', 'skirt']] },
  { k: 'mask', label: 'fMask', opts: [['yes', 'masked'], ['no', 'noMask']] },
  { k: 'acc', label: 'fAcc', opts: [['bag', 'bag'], ['hat', 'hat']] },
]

const VTYPE: Record<string, [string, string]> = { car: ['Ô tô', 'Car'], suv: ['SUV', 'SUV'], motorbike: ['Xe máy', 'Motorbike'], truck: ['Xe tải', 'Truck'] }
const BOTTOM: Record<string, [string, string]> = { pants: ['quần dài', 'trousers'], shorts: ['quần short', 'shorts'], skirt: ['váy', 'skirt'] }

export function labelOf(d: Pick<Detection, 'kind' | 'track_id' | 'plate' | 'attributes'>, lang: 'vi' | 'en') {
  const i = lang === 'vi' ? 0 : 1
  if (d.kind === 'person') return `${['Người', 'Person'][i]} ${d.track_id}`
  return `${(VTYPE[d.attributes.vehicle_type || 'car'] || VTYPE.car)[i]} ${d.plate || d.track_id}`
}

export function attrOf(d: Pick<Detection, 'kind' | 'attributes'>, lang: 'vi' | 'en') {
  const a = d.attributes || {}
  const i = lang === 'vi' ? 0 : 1
  if (d.kind === 'vehicle') {
    const vt = (VTYPE[a.vehicle_type || 'car'] || VTYPE.car)[i]
    return a.color ? `${vt} ${colorName(a.color, lang)}` : vt
  }
  const out: string[] = []
  if (a.gender) out.push(a.gender === 'm' ? ['nam', 'male'][i] : ['nữ', 'female'][i])
  if (a.top_color) out.push(`${['áo', 'top'][i]} ${colorName(a.top_color, lang)}${a.top === 'long' ? [' dài tay', ' long sleeve'][i] : ''}`)
  if (a.bottom) out.push(`${BOTTOM[a.bottom][i]} ${colorName(a.bottom_color, lang)}`.trim())
  if (a.mask) out.push(['đeo khẩu trang', 'masked'][i])
  if (a.accessories?.includes('bag')) out.push(['ba lô', 'bag'][i])
  if (a.accessories?.includes('hat')) out.push(['mũ', 'hat'][i])
  return out.join(', ')
}

export const detColors = (d: Pick<Detection, 'attributes'>) => [d.attributes.top_color, d.attributes.bottom_color, d.attributes.color].filter(Boolean) as string[]

/** Linear interpolation between the sampled boxes (sampled at the analysis FPS). */
export function boxAt(d: Pick<Detection, 'boxes'>, t: number) {
  const b = d.boxes
  if (!b.length) return null
  if (t <= b[0].t) return b[0]
  if (t >= b[b.length - 1].t) return b[b.length - 1]
  let lo = 0
  let hi = b.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (b[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = b[lo]
  const c = b[hi]
  const f = (t - a.t) / Math.max(1e-6, c.t - a.t)
  return { t, x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, w: a.w + (c.w - a.w) * f, h: a.h + (c.h - a.h) * f }
}

export const plateNorm = (p: string) => p.toUpperCase().replace(/[^0-9A-Z*?]/g, '')
export const camGuess = (name: string, seq: number) => (name.toUpperCase().match(/CAM_[A-Z]{2,3}_\d{2,4}/) || [`CAM_UP_${String(seq).padStart(2, '0')}`])[0]
