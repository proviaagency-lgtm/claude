// Business assumptions shared by an organisation. Percentages are stored 0–100.

import { coerceField } from './fields.js';

export const DEFAULT_SETTINGS = Object.freeze({
  applyOosBehavior: true,
  oosSameItemOtherStore: 31,
  oosDelay: 15,
  oosSameBrand: 19,
  oosOtherBrand: 26,
  oosNoPurchase: 9,
  shelfElasticity: 0.17,
  restockDays: 3,
  safetyFactor: 1.5,
  horizonWeeks: 52,
  rampWeeks: 8,
  cannibalization: 20,
  promoDiscountAlert: 34,
  defaultVatRate: 5.5,
  defaultMfgMarginRate: 35,
});

export const OOS_BEHAVIOR_KEYS = [
  'oosSameItemOtherStore',
  'oosDelay',
  'oosSameBrand',
  'oosOtherBrand',
  'oosNoPurchase',
];

export const SETTINGS_SECTIONS = [
  {
    id: 'oos',
    title: 'Comportement du consommateur face à une rupture',
    intro: 'Quand une référence manque en rayon, le client ne renonce pas toujours à son achat. '
      + 'Ces cinq réactions se partagent les ventes manquées et doivent totaliser 100 %. '
      + 'Valeurs par défaut : moyennes mondiales de l’étude Gruen, Corsten et Bharadwaj (2002).',
    fields: [
      {
        key: 'applyOosBehavior',
        label: 'Tenir compte de ces reports dans le calcul des ruptures',
        type: 'boolean',
        help: 'Décoché, 100 % des ventes manquées sont comptées comme perdues.',
      },
      {
        key: 'oosSameItemOtherStore',
        label: 'Achète la même référence dans un autre magasin',
        type: 'percent',
        note: 'Perdu pour l’enseigne, conservé par l’industriel.',
      },
      {
        key: 'oosDelay',
        label: 'Reporte son achat',
        type: 'percent',
        note: 'Considéré comme récupéré plus tard.',
      },
      {
        key: 'oosSameBrand',
        label: 'Prend une autre référence de la même marque',
        type: 'percent',
        note: 'Conservé par l’industriel et par l’enseigne.',
      },
      {
        key: 'oosOtherBrand',
        label: 'Prend une marque concurrente',
        type: 'percent',
        note: 'Perdu pour l’industriel.',
      },
      {
        key: 'oosNoPurchase',
        label: 'Renonce à l’achat',
        type: 'percent',
        note: 'Perdu pour l’industriel et pour l’enseigne.',
      },
    ],
  },
  {
    id: 'shelf',
    title: 'Linéaire et facings',
    fields: [
      {
        key: 'shelfElasticity',
        label: 'Élasticité des ventes au linéaire',
        type: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        help: '0,17 est la moyenne de la méta-analyse d’Eisend (2014) : doubler les facings '
          + 'augmente alors les ventes d’environ 12,5 %. Ajustez selon votre catégorie.',
      },
      {
        key: 'restockDays',
        label: 'Jours entre deux réassorts en rayon',
        type: 'number',
        min: 0.5,
        max: 30,
        step: 0.5,
        help: 'Valeur proposée par défaut dans les scénarios de facings.',
      },
      {
        key: 'safetyFactor',
        label: 'Coefficient de sécurité de la capacité rayon',
        type: 'number',
        min: 1,
        max: 5,
        step: 0.1,
        help: 'La capacité en rayon doit couvrir les ventes entre deux réassorts multipliées '
          + 'par ce coefficient (1,5 est la règle usuelle).',
      },
    ],
  },
  {
    id: 'launch',
    title: 'Nouveaux produits et horizons',
    fields: [
      {
        key: 'horizonWeeks',
        label: 'Horizon de calcul des potentiels (semaines)',
        type: 'integer',
        min: 1,
        max: 260,
        help: 'Durée sur laquelle sont chiffrés les nouveaux produits et les facings.',
      },
      {
        key: 'rampWeeks',
        label: 'Montée en charge d’une innovation (semaines)',
        type: 'integer',
        min: 0,
        max: 104,
        help: 'Délai pour atteindre la rotation cible après l’implantation.',
      },
      {
        key: 'cannibalization',
        label: 'Cannibalisation par défaut sur votre gamme (%)',
        type: 'percent',
        help: 'Part des ventes d’une innovation prise à vos propres références.',
      },
    ],
  },
  {
    id: 'promo',
    title: 'Opérations promotionnelles',
    fields: [
      {
        key: 'promoDiscountAlert',
        label: 'Seuil d’alerte sur la remise consommateur (%)',
        type: 'percent',
        help: '34 % correspond au plafond des promotions en valeur fixé par l’encadrement '
          + 'EGalim. Vérifiez la réglementation applicable à vos catégories.',
      },
    ],
  },
  {
    id: 'economics',
    title: 'Économie produit par défaut',
    fields: [
      {
        key: 'defaultVatRate',
        label: 'TVA par défaut (%)',
        type: 'percent',
        max: 30,
        help: '5,5 % pour la plupart des produits alimentaires (20 % notamment pour la '
          + 'confiserie), 20 % pour le non alimentaire.',
      },
      {
        key: 'defaultMfgMarginRate',
        label: 'Marge brute industriel par défaut (% du prix net)',
        type: 'percent',
        help: 'Utilisée pour estimer la marge des produits dont le coût de revient '
          + 'n’est pas renseigné.',
      },
    ],
  },
];

export const SETTINGS_FIELDS = SETTINGS_SECTIONS.flatMap((section) => section.fields);

export function oosBehaviorTotal(settings) {
  return OOS_BEHAVIOR_KEYS.reduce((sum, key) => sum + (Number(settings[key]) || 0), 0);
}

/**
 * Coerces and checks a settings object. Unknown keys are dropped; missing keys
 * keep their default. Returns { value, errors, ok }.
 */
export function validateSettings(input = {}) {
  const value = { ...DEFAULT_SETTINGS };
  const errors = {};
  for (const field of SETTINGS_FIELDS) {
    if (!(field.key in input)) continue;
    const { value: coerced, error } = coerceField(field, input[field.key]);
    if (error) errors[field.key] = error;
    else if (coerced !== undefined) value[field.key] = coerced;
  }
  const total = oosBehaviorTotal(value);
  if (Math.abs(total - 100) > 0.5) {
    errors.oosBehavior = `Les cinq réactions totalisent ${String(Math.round(total * 10) / 10).replace('.', ',')} % au lieu de 100 %.`;
  }
  return { value, errors, ok: Object.keys(errors).length === 0 };
}

/** Settings read from storage: invalid or missing values fall back to defaults. */
export function normalizeSettings(input) {
  const { value } = validateSettings(input && typeof input === 'object' ? input : {});
  if (Math.abs(oosBehaviorTotal(value) - 100) > 0.5) {
    for (const key of OOS_BEHAVIOR_KEYS) value[key] = DEFAULT_SETTINGS[key];
  }
  return value;
}
