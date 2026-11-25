// display_meta_table / avgDialogSettingData, in the original toggle order.
export const dialogPresets = [
  { id: 1, label: '小', nameSize: 28, messageSize: 22, frameHeight: 182 },
  { id: 2, label: '中', nameSize: 30, messageSize: 24, frameHeight: 182 },
  { id: 3, label: '大', nameSize: 30, messageSize: 26, frameHeight: 220 },
] as const;
export const defaultDialogPreset = dialogPresets[1];
