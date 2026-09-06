import { z } from 'zod';

import { db } from '../../config/database.js';
import { jobItemQuoteLines, jobItemQuotes } from '../../db/schema/index.js';
import { QuoteComponentInput } from '../customerService/cs.validation.js';

type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


export const roundMoney = (value: number) =>
  Math.round(value * 100) / 100;

export const moneyString = (value: number) => roundMoney(value).toFixed(2);

export const buildQuoteLineValues = (
  quoteId: string ,
  components: QuoteComponentInput[],
) => {
  const lines = components.map((component, index) => {
    const quantity = component.quantity ?? 1;
    const unitPrice = roundMoney(component.unitPrice);
    const lineTotal = roundMoney(quantity * unitPrice);

    return {
      quoteId,
      name: component.name,
      quantity,
      unitPrice: moneyString(unitPrice),
      lineTotal: moneyString(lineTotal),
      sortOrder: index,
    };
  });

  const componentsCost = roundMoney(
    lines.reduce((sum, line) => sum + Number(line.lineTotal), 0),
  );

  return { lines, componentsCost };
};

export const insertQuoteLines = async (
  tx: DbTransaction,
  quoteId: string,
  components: QuoteComponentInput[],
) => {
  const built = buildQuoteLineValues(quoteId, components);

  if (built.lines.length > 0) {
    await tx.insert(jobItemQuoteLines).values(built.lines);
  }

  return built;
};

export const resolveQuoteComponents = (components?: QuoteComponentInput[],fallbackCost?: number):QuoteComponentInput[]|null => {
  if (components && components.length > 0) {
    return components;
  }

  if (fallbackCost == null) {
    return null;
  }

  return [
    {
      name: 'Components',
      quantity: 1,
      unitPrice: fallbackCost,
    },
  ];
};

export const insertJobItemQuoteWithLines = async (
  tx: DbTransaction,
  input: {
    jobItemId: string;
    version: number;
    components: QuoteComponentInput[];
    serviceCharge: string | number;
    createdByUserId: string;
    status: string;
  },
) => {
  const preview = buildQuoteLineValues('preview', input.components);
  const serviceChargeAmount = Number(input.serviceCharge);
  const totalAmount = roundMoney(preview.componentsCost + serviceChargeAmount);

  const [quote] = await tx
    .insert(jobItemQuotes)
    .values({
      jobItemId: input.jobItemId,
      version: input.version,
      componentsCost: moneyString(preview.componentsCost),
      serviceCharge:
        typeof input.serviceCharge === 'string'
          ? input.serviceCharge
          : moneyString(serviceChargeAmount),
      totalAmount: moneyString(totalAmount),
      createdByUserId: input.createdByUserId,
      customerApproved: null,
      status: input.status,
    })
    .returning();

  const { lines } = await insertQuoteLines(tx, quote.id, input.components);

  return {
    quote,
    lines,
    componentsCost: preview.componentsCost,
    totalAmount,
    serviceChargeAmount,
  };
};
