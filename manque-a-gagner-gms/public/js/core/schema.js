// Data model shared by the browser and the server: one definition per
// collection drives forms, validation, CSV import/export and the API whitelist.

import { coerceField, isEmpty } from './fields.js';
import { toDayNumber } from './dates.js';

const text = (key, label, opts = {}) => ({ key, label, type: 'text', ...opts });
const area = (key, label, opts = {}) => ({ key, label, type: 'textarea', ...opts });
const num = (key, label, opts = {}) => ({ key, label, type: 'number', min: 0, ...opts });
const int = (key, label, opts = {}) => ({ key, label, type: 'integer', min: 0, ...opts });
const pct = (key, label, opts = {}) => ({ key, label, type: 'percent', ...opts });
const date = (key, label, opts = {}) => ({ key, label, type: 'date', ...opts });
const select = (key, label, options, opts = {}) => ({ key, label, type: 'select', options, ...opts });
const ref = (key, label, collection, opts = {}) => ({ key, label, type: 'ref', collection, ...opts });

export const RETAILER_FORMATS = [
  { value: 'hyper', label: 'Hypermarché' },
  { value: 'super', label: 'Supermarché' },
  { value: 'proxi', label: 'Proximité' },
  { value: 'drive', label: 'Drive' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'discount', label: 'Hard discount' },
  { value: 'multi', label: 'Multi-formats' },
];

export const PRODUCT_STATUSES = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'innovation', label: 'Innovation' },
];

export const STOCKOUT_METHODS = [
  { value: 'event', label: 'Jours de rupture × magasins' },
  { value: 'rate', label: 'Taux de rupture sur une période' },
];

export const STOCKOUT_CAUSES = [
  { value: 'entrepot', label: 'Rupture entrepôt / plateforme' },
  { value: 'commande', label: 'Commande magasin insuffisante' },
  { value: 'rayon', label: 'Défaut de mise en rayon' },
  { value: 'industriel', label: 'Rupture industriel (usine)' },
  { value: 'blocage', label: 'Blocage ou déréférencement' },
  { value: 'promo', label: 'Sur-demande liée à une promo' },
  { value: 'autre', label: 'Autre ou inconnue' },
];

export const PROMO_MECHANICS = [
  { value: 'remise', label: 'Remise immédiate' },
  { value: 'lot', label: 'Lot / multipack' },
  { value: 'gratuite', label: 'Gratuité (ex. 2 + 1 offert)' },
  { value: 'fidelite', label: 'Avantage carte fidélité' },
  { value: 'prospectus', label: 'Prospectus / catalogue' },
  { value: 'tg', label: 'Tête de gondole' },
  { value: 'mea', label: 'Mise en avant / îlot' },
  { value: 'autre', label: 'Autre' },
];

const productRef = ref('productId', 'Produit', 'products', {
  required: true,
  csvHeaders: ['EAN', 'Produit'],
});
const retailerRef = ref('retailerId', 'Enseigne', 'retailers', {
  required: true,
  csvHeaders: ['Enseigne'],
});
const comment = area('comment', 'Commentaire');

export const COLLECTIONS = {
  products: {
    key: 'products',
    label: 'Produits',
    singular: 'produit',
    fields: [
      text('ean', 'EAN', {
        pattern: /^\d{8}$|^\d{12,14}$/,
        patternMessage: 'Code EAN de 8 ou 13 chiffres attendu.',
        aliases: ['gencod', 'code ean', 'ean13', 'code barre'],
      }),
      text('name', 'Libellé', { required: true, aliases: ['produit', 'désignation', 'libelle produit', 'référence'] }),
      text('brand', 'Marque'),
      text('category', 'Gamme / catégorie', { aliases: ['gamme', 'catégorie', 'famille', 'segment'] }),
      select('status', 'Statut', PRODUCT_STATUSES, { default: 'permanent' }),
      num('pvcTtc', 'PVC moyen TTC (€)', {
        required: true,
        step: 0.01,
        aliases: ['pvc', 'pvc ttc', 'prix de vente consommateur', 'prix consommateur'],
        help: 'Prix de vente consommateur moyen constaté en magasin.',
      }),
      pct('vatRate', 'TVA (%)', {
        max: 30,
        step: 0.1,
        fallback: 'defaultVatRate',
        aliases: ['tva', 'taux de tva'],
      }),
      num('netPrice', 'Prix net industriel (€ HT)', {
        required: true,
        step: 0.01,
        aliases: ['prix net', 'prix net net', 'prix triple net', 'prix 3 fois net', 'prix d achat net'],
        help: 'Prix « trois fois net » facturé à l’enseigne, par UVC.',
      }),
      num('unitCost', 'Coût de revient (€ / UVC)', {
        step: 0.01,
        aliases: ['coût de revient', 'cout de revient', 'prix de revient', 'cogs'],
        help: 'Laissez vide pour estimer la marge avec le taux par défaut des paramètres.',
      }),
      num('rot', 'Rotation de référence (UVC / magasin / semaine)', {
        step: 0.1,
        aliases: ['rot', 'rotation', 'vmh', 'ventes moyennes hebdomadaires'],
        help: 'Ventes moyennes d’un magasin en une semaine, hors promotion.',
      }),
      int('unitsPerFacing', 'Capacité par facing (UVC)', {
        min: 1,
        aliases: ['capacité facing', 'uvc par facing'],
        help: 'Nombre d’UVC rangées derrière une frontale (profondeur × hauteur).',
      }),
    ],
  },

  retailers: {
    key: 'retailers',
    label: 'Enseignes',
    singular: 'enseigne',
    fields: [
      text('name', 'Enseigne', { required: true, aliases: ['nom', 'client', 'distributeur'] }),
      select('format', 'Format', RETAILER_FORMATS, { default: 'hyper' }),
      int('stores', 'Nombre de magasins', { aliases: ['magasins', 'nb magasins', 'parc'] }),
      text('kam', 'Responsable du compte', { aliases: ['kam', 'responsable', 'key account manager'] }),
    ],
  },

  stockouts: {
    key: 'stockouts',
    label: 'Ruptures',
    singular: 'rupture',
    fields: [
      productRef,
      retailerRef,
      text('store', 'Magasin', { aliases: ['point de vente', 'pdv'], help: 'Facultatif : nom ou code du magasin.' }),
      select('method', 'Méthode de calcul', STOCKOUT_METHODS, { default: 'event', aliases: ['méthode'] }),
      date('startDate', 'Début', {
        required: true,
        aliases: ['date début', 'date de début', 'du', 'début période'],
      }),
      date('endDate', 'Fin', {
        aliases: ['date fin', 'date de fin', 'au', 'fin période'],
        help: 'Laissez vide si la rupture est toujours en cours.',
        requiredIf: (r) => r.method === 'rate',
      }),
      int('stores', 'Magasins concernés', {
        min: 1,
        default: 1,
        showIf: (r) => r.method !== 'rate',
        aliases: ['nb magasins', 'magasins'],
      }),
      num('rot', 'Rotation (UVC / magasin / semaine)', {
        step: 0.1,
        showIf: (r) => r.method !== 'rate',
        aliases: ['rot', 'rotation'],
        help: 'Laissez vide pour utiliser la rotation de référence du produit.',
      }),
      num('soldUnits', 'Ventes réalisées sur la période (UVC)', {
        showIf: (r) => r.method === 'rate',
        requiredIf: (r) => r.method === 'rate',
        aliases: ['ventes', 'ventes uvc', 'volume vendu'],
      }),
      pct('oosRate', 'Taux de rupture (%)', {
        max: 99,
        step: 0.1,
        showIf: (r) => r.method === 'rate',
        requiredIf: (r) => r.method === 'rate',
        aliases: ['taux de rupture', 'rupture', 'oos'],
      }),
      select('cause', 'Cause', STOCKOUT_CAUSES, { default: 'autre', aliases: ['motif', 'origine'] }),
      comment,
    ],
    validate(r) {
      if (r.startDate && r.endDate && toDayNumber(r.endDate) < toDayNumber(r.startDate)) {
        return { endDate: 'La fin doit être postérieure au début.' };
      }
      return {};
    },
  },

  promotions: {
    key: 'promotions',
    label: 'Opérations',
    singular: 'opération',
    fields: [
      text('name', 'Opération', {
        required: true,
        aliases: ['nom opération', 'nom de l opération', 'opé', 'animation'],
        help: 'Les lignes portant le même nom sont regroupées.',
      }),
      retailerRef,
      select('mechanic', 'Mécanique', PROMO_MECHANICS, { default: 'remise', aliases: ['mécanique promo', 'type'] }),
      date('startDate', 'Début', { required: true, aliases: ['date début', 'date de début', 'du'] }),
      date('endDate', 'Fin', { required: true, aliases: ['date fin', 'date de fin', 'au'] }),
      productRef,
      pct('discountPct', 'Remise consommateur (%)', {
        step: 0.1,
        default: 0,
        aliases: ['remise', 'taux de remise', 'remise conso'],
        help: 'Pour un « 2 + 1 offert », saisissez 33 %.',
      }),
      pct('fundedPct', 'Part de la remise financée par l’industriel (%)', {
        default: 100,
        aliases: ['part financée', 'financement industriel'],
      }),
      num('baseRot', 'Rotation hors promo (UVC / magasin / semaine)', {
        step: 0.1,
        aliases: ['rot de base', 'rot hors promo', 'rotation de base'],
        help: 'Laissez vide pour utiliser la rotation de référence du produit.',
      }),
      num('uplift', 'Coefficient promo (×)', {
        required: true,
        min: 1,
        max: 50,
        step: 0.1,
        default: 2.5,
        aliases: ['coefficient', 'coef', 'uplift', 'multiplicateur'],
        help: 'Multiplicateur des ventes pendant l’opération (3 = ventes × 3).',
      }),
      int('storesTargeted', 'Magasins prévus', {
        required: true,
        aliases: ['magasins ciblés', 'magasins prévus', 'nb magasins prévus'],
      }),
      int('storesActive', 'Magasins ayant implanté', {
        required: true,
        aliases: ['magasins implantés', 'magasins participants', 'nb magasins implantés'],
      }),
      num('oosDays', 'Jours de rupture moyens par magasin implanté', {
        step: 0.5,
        default: 0,
        aliases: ['jours de rupture', 'rupture jours'],
      }),
      num('actualUnits', 'Ventes réalisées (UVC)', {
        aliases: ['ventes réalisées', 'volume réalisé'],
        help: 'Facultatif : pour mesurer le taux de réalisation de l’opération.',
      }),
      comment,
    ],
    validate(r) {
      const errors = {};
      if (r.startDate && r.endDate && toDayNumber(r.endDate) < toDayNumber(r.startDate)) {
        errors.endDate = 'La fin doit être postérieure au début.';
      }
      return errors;
    },
  },

  listings: {
    key: 'listings',
    label: 'Nouveaux produits',
    singular: 'référencement',
    fields: [
      productRef,
      retailerRef,
      date('launchDate', 'Date d’implantation', { aliases: ['date de lancement', 'lancement', 'implantation'] }),
      int('storesTarget', 'Magasins cibles', {
        required: true,
        aliases: ['magasins cibles', 'cible', 'nb magasins cibles'],
      }),
      int('storesListed', 'Magasins ayant référencé', {
        required: true,
        aliases: ['magasins référencés', 'référencés', 'nb magasins référencés'],
      }),
      num('rot', 'Rotation cible (UVC / magasin / semaine)', {
        step: 0.1,
        aliases: ['rot cible', 'rotation cible', 'rot'],
        help: 'Laissez vide pour utiliser la rotation de référence du produit.',
      }),
      int('weeks', 'Horizon (semaines)', {
        min: 1,
        max: 260,
        fallback: 'horizonWeeks',
        aliases: ['horizon', 'semaines'],
      }),
      int('rampWeeks', 'Montée en charge (semaines)', {
        max: 104,
        fallback: 'rampWeeks',
        aliases: ['montée en charge'],
      }),
      pct('cannibalization', 'Cannibalisation de votre gamme (%)', {
        fallback: 'cannibalization',
        aliases: ['cannibalisation'],
      }),
      num('delayWeeks', 'Retard d’implantation (semaines)', {
        max: 260,
        step: 0.5,
        default: 0,
        aliases: ['retard', 'retard semaines'],
      }),
      num('listingCost', 'Coût de référencement (€)', {
        aliases: ['coût de référencement', 'budget', 'coopération commerciale'],
        help: 'Facultatif : budget versé à l’enseigne, pour calculer le retour sur investissement.',
      }),
      comment,
    ],
  },

  facings: {
    key: 'facings',
    label: 'Facings',
    singular: 'scénario de facings',
    fields: [
      productRef,
      retailerRef,
      int('stores', 'Magasins concernés', { required: true, min: 1, aliases: ['nb magasins', 'magasins'] }),
      int('currentFacings', 'Facings actuels', {
        required: true,
        min: 1,
        max: 200,
        aliases: ['facings actuels', 'frontales actuelles', 'facing actuel'],
      }),
      int('proposedFacings', 'Facings proposés', {
        required: true,
        min: 1,
        max: 200,
        aliases: ['facings proposés', 'frontales proposées', 'facing cible'],
      }),
      num('rot', 'Rotation actuelle (UVC / magasin / semaine)', {
        step: 0.1,
        aliases: ['rot', 'rotation'],
        help: 'Laissez vide pour utiliser la rotation de référence du produit.',
      }),
      num('elasticity', 'Élasticité au linéaire', {
        max: 1,
        step: 0.01,
        fallback: 'shelfElasticity',
        aliases: ['élasticité'],
      }),
      int('weeks', 'Horizon (semaines)', {
        min: 1,
        max: 260,
        fallback: 'horizonWeeks',
        aliases: ['horizon', 'semaines'],
      }),
      int('unitsPerFacing', 'Capacité par facing (UVC)', {
        min: 1,
        aliases: ['capacité facing', 'uvc par facing'],
        help: 'Laissez vide pour reprendre la capacité indiquée sur la fiche produit.',
      }),
      num('restockDays', 'Jours entre deux réassorts', {
        min: 0.5,
        max: 30,
        step: 0.5,
        fallback: 'restockDays',
        aliases: ['réassort', 'jours réassort'],
      }),
      pct('currentOosRate', 'Taux de rupture actuel (%)', {
        max: 99,
        step: 0.1,
        aliases: ['taux de rupture actuel'],
      }),
      pct('targetOosRate', 'Taux de rupture attendu après (%)', {
        max: 99,
        step: 0.1,
        aliases: ['taux de rupture cible', 'taux de rupture visé'],
      }),
      pct('marketShare', 'Part de marché dans le segment (%)', {
        step: 0.1,
        aliases: ['pdm', 'part de marché'],
      }),
      int('segmentFacings', 'Facings totaux du segment', {
        min: 1,
        aliases: ['facings segment', 'facings totaux'],
      }),
      comment,
    ],
    validate(r) {
      const errors = {};
      if ((r.currentOosRate === undefined) !== (r.targetOosRate === undefined)) {
        const key = r.currentOosRate === undefined ? 'currentOosRate' : 'targetOosRate';
        errors[key] = 'Renseignez les deux taux de rupture, ou aucun.';
      }
      if ((r.marketShare === undefined) !== (r.segmentFacings === undefined)) {
        const key = r.marketShare === undefined ? 'marketShare' : 'segmentFacings';
        errors[key] = 'Renseignez la part de marché et les facings du segment, ou aucun.';
      }
      if (r.segmentFacings !== undefined && r.currentFacings !== undefined && r.segmentFacings < r.currentFacings) {
        errors.segmentFacings = 'Le segment compte au moins les facings actuels du produit.';
      }
      return errors;
    },
  },
};

export const COLLECTION_KEYS = Object.keys(COLLECTIONS);
export const LEVERS = ['stockouts', 'promotions', 'listings', 'facings'];

export function fieldVisible(field, record) {
  return !field.showIf || field.showIf(record);
}

export function fieldRequired(field, record) {
  return Boolean(field.required || (field.requiredIf && field.requiredIf(record)));
}

/**
 * A blank record with its fixed defaults (used by "Ajouter" forms). Fields
 * with a `fallback` stay empty so they keep following the settings.
 */
export function newRecord(collectionKey) {
  const record = {};
  for (const field of COLLECTIONS[collectionKey].fields) {
    if (field.default !== undefined) record[field.key] = field.default;
  }
  return record;
}

/**
 * Coerces and validates a record. Unknown keys are dropped, hidden fields are
 * cleared. `refExists(collection, id)` lets the caller check references.
 * Returns { value, errors, ok }.
 */
export function validateRecord(collectionKey, input, { refExists } = {}) {
  const collection = COLLECTIONS[collectionKey];
  if (!collection) throw new Error(`Unknown collection: ${collectionKey}`);
  const source = input && typeof input === 'object' ? input : {};
  const value = {};
  const errors = {};

  for (const field of collection.fields) {
    const { value: coerced, error } = coerceField(field, source[field.key]);
    if (error) errors[field.key] = error;
    else if (coerced !== undefined) value[field.key] = coerced;
    else if (field.type === 'select' && typeof field.default === 'string') value[field.key] = field.default;
  }

  for (const field of collection.fields) {
    if (!fieldVisible(field, value)) {
      delete value[field.key];
      delete errors[field.key];
      continue;
    }
    if (errors[field.key]) continue;
    if (fieldRequired(field, value) && isEmpty(value[field.key])) {
      errors[field.key] = 'Champ obligatoire.';
    } else if (field.type === 'ref' && value[field.key] && refExists && !refExists(field.collection, value[field.key])) {
      errors[field.key] = field.collection === 'products' ? 'Produit introuvable.' : 'Enseigne introuvable.';
    }
  }

  if (collection.validate) {
    for (const [key, message] of Object.entries(collection.validate(value))) {
      if (!errors[key]) errors[key] = message;
    }
  }
  return { value, errors, ok: Object.keys(errors).length === 0 };
}
