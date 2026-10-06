import { useUI } from './store'

/** Every UI string goes through here (NFR-I18N-01). Business data stays in its original language. */
const vi = {
  caseTab: 'Tổng quan', footage: 'Xem video', report: 'Tìm đối tượng', tags: 'Đánh dấu', map: 'Bản đồ', image: 'Xử lý ảnh', assistant: 'Trợ lý AI',
  caseShort: 'Tổng quan', footageShort: 'Video', reportShort: 'Tìm kiếm', tagsShort: 'Đánh dấu', imageShort: 'Ảnh',
  addCase: 'Tạo vụ án', casesTitle: 'Vụ án', quickGuide: 'Hướng dẫn nhanh', help: 'Hướng dẫn', searchPh: 'Tìm vụ án, video, camera',
  analyzing: 'Đang phân tích', analyzed: 'Đã phân tích', noVideo: 'Không có video khớp',
  objects: 'đối tượng', events: 'Đối tượng AI phát hiện', eventsHint: 'Bấm một dòng để tua tới lúc đối tượng xuất hiện', all: 'Tất cả', people: 'Người', vehicles: 'Phương tiện',
  cut: 'Cắt đoạn', snapBtn: 'Chụp', markBtn: 'Đánh dấu', shortcuts: 'Phím tắt',
  aiEnhance: 'Cải thiện AI', venhHint: 'Kéo thanh chia trên video để so sánh', venhExport: 'Xuất video đã cải thiện',
  vDenoise: 'Khử nhiễu', vLowlight: 'Tăng sáng vùng tối', vStab: 'Chống rung', vSuper: 'Siêu phân giải 2×', vDeblur: 'Khử mờ chuyển động',
  original: 'Gốc', enhancedLabel: 'Đã cải thiện bởi AI',
  person: 'Con người', gait: 'Dáng người', face: 'Khuôn mặt', zone: 'Vùng nhận diện', vehicle: 'Phương tiện', plate: 'Biển số',
  nlPh: 'Mô tả đối tượng cần tìm, ví dụ: nam áo đen đeo ba lô', find: 'Tìm', nlUnderstood: 'Đã hiểu',
  nlNone: 'Chưa nhận ra thuộc tính nào. Thử: nam, nữ, áo đen, quần short, khẩu trang, ba lô, xe bạc.', undo: 'Hoàn tác',
  filters: 'Bộ lọc', time: 'Thời gian', from: 'Từ', to: 'Đến', fGender: 'Giới tính', fTop: 'Áo', fBottom: 'Quần, váy', fMask: 'Khẩu trang', fAcc: 'Phụ kiện', fColor: 'Màu sắc',
  male: 'Nam', female: 'Nữ', long: 'Dài tay', short: 'Ngắn tay', pants: 'Quần dài', shorts: 'Quần short', skirt: 'Váy', masked: 'Có đeo', noMask: 'Không đeo', bag: 'Túi / ba lô', hat: 'Mũ',
  reset: 'Đặt lại', exportPdf: 'Xuất báo cáo PDF', showResults: 'Xem kết quả', results: 'kết quả', inVideos: 'từ {n} video', attach: '{n} ảnh đính kèm',
  noResults: 'Không có kết quả khớp', noResultsHint: 'Bỏ bớt điều kiện hoặc chọn thêm video ở cột trái.', resetFilters: 'Đặt lại bộ lọc', sortTime: 'Thời gian', sortConf: 'Độ tin cậy',
  viewInFootage: 'Xem trong video', addTag: 'Gắn thẻ', findSimilar: 'Tìm người tương tự', confidence: 'Độ tin cậy', camera: 'Camera', appear: 'Xuất hiện', type: 'Loại', color: 'Màu',
  tagsTitle: 'Đánh dấu', tagsSub: 'Các thời điểm và đối tượng bạn đã gắn thẻ trong vụ án', noTags: 'Chưa có thẻ nào khớp',
  noTagsHint: 'Nhấn B khi xem video, hoặc gắn thẻ từ kết quả trong Tìm đối tượng.', cycleColor: 'Đổi màu thẻ', notePh: 'Thêm ghi chú', deleteTag: 'Xóa thẻ', allColors: 'Tất cả màu',
  addByCoord: 'Thêm bằng tọa độ', addOnMap: 'Đặt trên bản đồ', clickMapHint: 'Nhấn vào bản đồ để đặt camera', trackResults: 'Đối tượng đã theo dõi', route: 'Lộ trình qua camera',
  playRoute: 'Phát lộ trình', prev: 'Trước', next: 'Sau',
  region: 'Chọn vùng', openImg: 'Mở ảnh', frames: 'Khung hình', framesHint: 'AI xếp hạng theo độ rõ của đối tượng', best: 'Rõ nhất',
  oneTouch: 'Cải thiện một chạm', oneTouchBusy: 'Đang cải thiện', scenario: 'Tình huống', sPlate: 'Đọc biển số', sNight: 'Ban đêm', sBlur: 'Camera nhòe', sFace: 'Làm rõ mặt', suggested: 'Gợi ý',
  oSuper: 'Siêu phân giải vùng chọn', oDeblur: 'Khử mờ chuyển động', oDenoise: 'Khử nhiễu', advanced: 'Điều chỉnh thủ công',
  bright: 'Độ sáng', contrast: 'Tương phản', sat: 'Độ bão hòa', sharp: 'Độ sắc nét', zoomL: 'Phóng to', gray: 'Thang độ xám', invert: 'Đảo màu', edge: 'Tạo cạnh',
  redact: 'Làm mờ mặt, biển', toReport: 'Chèn vào báo cáo', dlOrig: 'Tải ảnh gốc', dlAi: 'Xuất kèm nhãn AI', askImage: 'Hỏi trợ lý về ảnh này', resetAi: 'Bỏ mọi xử lý',
  ocrTitle: 'Đọc biển số', ocrAlt: 'Phương án khác', ocrSearch: 'Tìm biển số này', copy: 'Sao chép', superTitle: 'Siêu phân giải 4×', noAnn: 'Ảnh tải lên chưa có nhãn AI.',
  cancel: 'Hủy', done: 'Xong', close: 'Đóng', save: 'Lưu', delete: 'Xóa', rename: 'Đổi tên', reprocess: 'Phân tích lại', videoReport: 'Tìm trong video này',
  overlayOn: 'Ẩn khung nhận diện', overlayOff: 'Hiện khung nhận diện', more: 'Tùy chọn khác', waiting: 'Đang chờ kết quả phân tích', noEvents: 'Không có đối tượng',
  noVideoSel: 'Chưa có video. Tải video lên để bắt đầu.',
  aiPh: 'Hỏi về video, ảnh hoặc vụ án', aiDisclaimer: 'AI có thể sai. Đối chiếu với dữ liệu gốc trước khi đưa vào hồ sơ.',
  aiHello: 'Tôi đọc được những gì bạn đang xem: video, khung hình, kết quả nhận diện. Hỏi bằng tiếng Việt bình thường.',
  notifs: 'Thông báo', markRead: 'Đánh dấu đã đọc', noNotifs: 'Không có thông báo mới', justNow: 'vừa xong', minAgo: '{n} phút trước', hrAgo: '{n} giờ trước', dayAgo: '{n} ngày trước',
  settings: 'Cài đặt', lock: 'Khóa phiên', logout: 'Đăng xuất', lockTitle: 'Phiên làm việc đã khóa', lockSub: 'Dữ liệu vụ án được ẩn cho đến khi bạn mở khóa.', pin: 'Mã PIN 6 số',
  unlock: 'Mở khóa', pinErr: 'Mã PIN gồm đúng 6 chữ số', tUnlocked: 'Đã mở khóa phiên', verified: 'Đã xác thực 2 lớp',
  minConf: 'Ngưỡng tin cậy tối thiểu', minConfHint: 'Ẩn kết quả dưới ngưỡng ở Xem video, Tìm đối tượng, Vùng nhận diện, Bản đồ, Đầu mối và trợ lý.', showing: 'Đang hiển thị {a} / {b} đối tượng',
  sWatermark: 'Đóng dấu mã vụ án khi xuất ảnh', sRedact: 'Luôn làm mờ mặt và biển số khi xuất', sNotify: 'Hiện thông báo nổi khi video phân tích xong', idleLock: 'Tự khóa sau khi không thao tác',
  tSaved: 'Đã lưu cài đặt', kGroupPlay: 'Phát lại', kGroupWork: 'Thao tác', kGroupApp: 'Ứng dụng', kPlay: 'phát / dừng', kSeek: '±5 giây', kFine: '±1 giây', kRange: 'điểm vào / ra',
  kAi: 'hỏi trợ lý', kShortcuts: 'mở bảng phím tắt', kEsc: 'đóng cửa sổ, menu, ngăn kéo', bookmarkL: 'đánh dấu', snapshotL: 'chụp khung hình',
  tipNewCase: 'Mỗi vụ án là một thư mục chứa video chứng cứ, kết quả phân tích và báo cáo', tipUploadTo: 'Tải video lên vụ án này',
  tipPlay: 'Phát / tạm dừng (Space)', tipBack: 'Lùi 5 giây (←)', tipFwd: 'Tiến 5 giây (→)', tipSpeed: 'Đổi tốc độ phát', tipMore: 'Phóng to, ẩn hiện khung nhận diện',
  tipIn: 'Đặt điểm bắt đầu đoạn cắt tại vị trí hiện tại (phím I)', tipOut: 'Đặt điểm kết thúc đoạn cắt (phím O)', tipCut: 'Tạo video con từ đoạn In → Out, nằm dưới video gốc',
  tipSnap: 'Chụp khung hình hiện tại, mở được trong Xử lý ảnh (phím S)', tipMark: 'Gắn thẻ thời điểm và đối tượng đang xuất hiện (phím B)',
  tipEnhance: 'Làm rõ video bằng AI: khử nhiễu, tăng sáng vùng tối, chống rung', tipAi: 'Hỏi trợ lý AI về video, ảnh hoặc vụ án (phím /)',
  tipHelp: 'Xem hướng dẫn từng bước và phím tắt', tipNotif: 'Thông báo: phân tích xong, khớp danh sách theo dõi, báo cáo sẵn sàng', tipUser: 'Tài khoản, cài đặt, giao diện, ngôn ngữ',
  tipAddCoord: 'Nhập tọa độ để đặt camera và gán vị trí cho video', tipAddOnMap: 'Nhấn vào bản đồ để đặt camera tại đó', tipLayer: 'Đổi lớp bản đồ nền',
  tipRegion: 'Kéo trên ảnh để chọn vùng cần phóng to, tăng độ phân giải', tipOpenImg: 'Mở một ảnh từ máy để xử lý', tipFilters: 'Bộ lọc giới tính, trang phục, màu sắc, thời gian',
  watchlist: 'Danh sách theo dõi', forbidden: 'Bạn không có quyền thực hiện thao tác này.',
}

type Key = keyof typeof vi

const en: Record<Key, string> = {
  caseTab: 'Overview', footage: 'Review video', report: 'Find subjects', tags: 'Tagged', map: 'Map', image: 'Image tools', assistant: 'AI assistant',
  caseShort: 'Overview', footageShort: 'Video', reportShort: 'Search', tagsShort: 'Tagged', imageShort: 'Image',
  addCase: 'New case', casesTitle: 'Cases', quickGuide: 'Quick guide', help: 'Help', searchPh: 'Search cases, videos, cameras',
  analyzing: 'Analyzing', analyzed: 'Analyzed', noVideo: 'No matching video',
  objects: 'objects', events: 'Subjects found by AI', eventsHint: 'Click a row to jump to when the subject appears', all: 'All', people: 'People', vehicles: 'Vehicles',
  cut: 'Cut clip', snapBtn: 'Snapshot', markBtn: 'Tag', shortcuts: 'Keyboard shortcuts',
  aiEnhance: 'AI enhance', venhHint: 'Drag the divider on the video to compare', venhExport: 'Export enhanced video',
  vDenoise: 'Denoise', vLowlight: 'Lift shadows', vStab: 'Stabilize', vSuper: 'Super-resolution 2×', vDeblur: 'Motion deblur',
  original: 'Original', enhancedLabel: 'Enhanced by AI',
  person: 'People', gait: 'Gait', face: 'Faces', zone: 'Zones', vehicle: 'Vehicles', plate: 'Plates',
  nlPh: 'Describe who you are looking for, e.g. man in black with a backpack', find: 'Search', nlUnderstood: 'Understood',
  nlNone: 'No attributes recognised. Try: man, woman, black top, shorts, mask, backpack, silver car.', undo: 'Undo',
  filters: 'Filters', time: 'Time', from: 'From', to: 'To', fGender: 'Gender', fTop: 'Top', fBottom: 'Bottom', fMask: 'Face mask', fAcc: 'Accessories', fColor: 'Colour',
  male: 'Male', female: 'Female', long: 'Long sleeve', short: 'Short sleeve', pants: 'Trousers', shorts: 'Shorts', skirt: 'Skirt', masked: 'Wearing', noMask: 'Not wearing', bag: 'Bag', hat: 'Hat',
  reset: 'Reset', exportPdf: 'Export PDF report', showResults: 'Show results', results: 'results', inVideos: 'from {n} videos', attach: '{n} images attached',
  noResults: 'No matching results', noResultsHint: 'Remove a filter or select more videos on the left.', resetFilters: 'Reset filters', sortTime: 'Time', sortConf: 'Confidence',
  viewInFootage: 'View in video', addTag: 'Tag', findSimilar: 'Find similar people', confidence: 'Confidence', camera: 'Camera', appear: 'Seen', type: 'Type', color: 'Colour',
  tagsTitle: 'Tagged', tagsSub: 'Moments and subjects you tagged in this case', noTags: 'No matching tags',
  noTagsHint: 'Press B while watching, or tag a result in Find subjects.', cycleColor: 'Change tag colour', notePh: 'Add a note', deleteTag: 'Delete tag', allColors: 'All colours',
  addByCoord: 'Add by coordinates', addOnMap: 'Place on map', clickMapHint: 'Click the map to place a camera', trackResults: 'Tracked subjects', route: 'Route across cameras',
  playRoute: 'Play route', prev: 'Previous', next: 'Next',
  region: 'Select region', openImg: 'Open image', frames: 'Frames', framesHint: 'Ranked by AI on subject clarity', best: 'Clearest',
  oneTouch: 'One-tap enhance', oneTouchBusy: 'Enhancing', scenario: 'Scenario', sPlate: 'Read plate', sNight: 'Night', sBlur: 'Blurry camera', sFace: 'Clarify face', suggested: 'Suggested',
  oSuper: 'Super-resolve selection', oDeblur: 'Motion deblur', oDenoise: 'Denoise', advanced: 'Manual adjustments',
  bright: 'Brightness', contrast: 'Contrast', sat: 'Saturation', sharp: 'Sharpness', zoomL: 'Zoom', gray: 'Grayscale', invert: 'Invert', edge: 'Edge detect',
  redact: 'Blur faces and plates', toReport: 'Insert into report', dlOrig: 'Download original', dlAi: 'Export with AI labels', askImage: 'Ask about this image', resetAi: 'Clear all processing',
  ocrTitle: 'Plate reading', ocrAlt: 'Alternatives', ocrSearch: 'Search this plate', copy: 'Copy', superTitle: 'Super-resolution 4×', noAnn: 'Uploaded image has no AI labels yet.',
  cancel: 'Cancel', done: 'Done', close: 'Close', save: 'Save', delete: 'Delete', rename: 'Rename', reprocess: 'Re-analyze', videoReport: 'Search this video',
  overlayOn: 'Hide detection boxes', overlayOff: 'Show detection boxes', more: 'More options', waiting: 'Waiting for analysis', noEvents: 'No subjects',
  noVideoSel: 'No video yet. Upload one to start.',
  aiPh: 'Ask about the video, image or case', aiDisclaimer: 'AI can be wrong. Verify against source data before adding to the case file.',
  aiHello: 'I can read what you are looking at: the video, the frame, the detections. Ask in plain language.',
  notifs: 'Notifications', markRead: 'Mark all read', noNotifs: 'No new notifications', justNow: 'just now', minAgo: '{n} min ago', hrAgo: '{n} h ago', dayAgo: '{n} d ago',
  settings: 'Settings', lock: 'Lock session', logout: 'Sign out', lockTitle: 'Session locked', lockSub: 'Case data stays hidden until you unlock.', pin: '6-digit PIN',
  unlock: 'Unlock', pinErr: 'PIN must be exactly 6 digits', tUnlocked: 'Session unlocked', verified: 'Two-factor verified',
  minConf: 'Minimum confidence', minConfHint: 'Hide detections below this in Video, Find subjects, Zones, Map, Leads and the assistant.', showing: 'Showing {a} of {b} subjects',
  sWatermark: 'Stamp case ID on exported images', sRedact: 'Always blur faces and plates on export', sNotify: 'Pop-up toast when a video finishes analysis', idleLock: 'Auto-lock after inactivity',
  tSaved: 'Settings saved', kGroupPlay: 'Playback', kGroupWork: 'Actions', kGroupApp: 'App', kPlay: 'play / pause', kSeek: '±5 s', kFine: '±1 s', kRange: 'mark in / out',
  kAi: 'ask assistant', kShortcuts: 'open shortcut sheet', kEsc: 'close dialog, menu or drawer', bookmarkL: 'tag moment', snapshotL: 'snapshot',
  tipNewCase: 'A case is a folder holding video evidence, analysis results and the report', tipUploadTo: 'Upload video to this case',
  tipPlay: 'Play / pause (Space)', tipBack: 'Back 5 s (←)', tipFwd: 'Forward 5 s (→)', tipSpeed: 'Change playback speed', tipMore: 'Zoom, show or hide detection boxes',
  tipIn: 'Set the clip start at the current position (I)', tipOut: 'Set the clip end (O)', tipCut: 'Create a child video from In → Out, filed under the original',
  tipSnap: 'Capture this frame for Image tools (S)', tipMark: 'Tag this moment and the subject on screen (B)',
  tipEnhance: 'Clarify video with AI: denoise, lift shadows, stabilize', tipAi: 'Ask the AI assistant about the video, image or case (/)',
  tipHelp: 'Step-by-step guide and shortcuts', tipNotif: 'Notifications: analysis done, watchlist matches, reports ready', tipUser: 'Account, settings, theme, language',
  tipAddCoord: 'Enter coordinates to place a camera and give a video its location', tipAddOnMap: 'Click the map to place a camera there', tipLayer: 'Change base map',
  tipRegion: 'Drag on the image to zoom and upscale a region', tipOpenImg: 'Open an image from your computer', tipFilters: 'Filter by gender, clothing, colour, time',
  watchlist: 'Watchlist', forbidden: 'You are not allowed to do this.',
}

const DICT = { vi, en }

export function translate(lang: 'vi' | 'en', key: Key, vars?: Record<string, string | number>) {
  let s: string = DICT[lang][key] ?? vi[key] ?? key
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, String(b))
  return s
}

/** `t(key)` for shared strings, `L(vi, en)` for one-off copy. */
export function useT() {
  const lang = useUI(s => s.lang)
  return {
    lang,
    t: (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars),
    L: (a: string, b: string) => (lang === 'vi' ? a : b),
  }
}

export type TKey = Key
