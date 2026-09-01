/** Official IJF senior men's weight categories, in competition order. */
export const IJF_SENIOR_MENS_WEIGHT_CLASSES = [
  "-60 kg", "-66 kg", "-73 kg", "-81 kg", "-90 kg", "-100 kg", "+100 kg",
] as const;

export type IjfSeniorMensWeightClass = typeof IJF_SENIOR_MENS_WEIGHT_CLASSES[number];

export function isIjfSeniorMensWeightClass(value: string): value is IjfSeniorMensWeightClass {
  return (IJF_SENIOR_MENS_WEIGHT_CLASSES as readonly string[]).includes(value);
}
