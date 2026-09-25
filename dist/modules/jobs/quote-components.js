import { jobItemQuoteLines, jobItemQuotes } from '../../db/schema/index.js';
export const roundMoney = (value) => Math.round(value * 100) / 100;
export const moneyString = (value) => roundMoney(value).toFixed(2);
export const buildQuoteLineValues = (quoteId, components) => {
    const lines = components.map((component, index) => {
        const quantity = component.quantity;
        const unitPrice = roundMoney(component.unitPrice);
        const lineTotal = roundMoney(quantity * unitPrice);
        return {
            quoteId,
            name: component.name,
            quantity,
            unitPrice: moneyString(unitPrice),
            warrantyMonths: component.warrantyMonths ?? 0,
            lineTotal: moneyString(lineTotal),
            sortOrder: index,
        };
    });
    const componentsCost = roundMoney(lines.reduce((sum, line) => sum + Number(line.lineTotal), 0));
    return { lines, componentsCost };
};
export const insertQuoteLines = async (tx, quoteId, components) => {
    const built = buildQuoteLineValues(quoteId, components);
    if (built.lines.length > 0) {
        await tx.insert(jobItemQuoteLines).values(built.lines);
    }
    return built;
};
export const resolveQuoteComponents = (components, fallbackCost) => {
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
            warrantyMonths: 0,
        },
    ];
};
export const insertJobItemQuoteWithLines = async (tx, input) => {
    const preview = buildQuoteLineValues('preview', input.components);
    const serviceChargeAmount = Number(input.serviceCharge);
    const totalAmount = roundMoney(preview.componentsCost + serviceChargeAmount);
    const [quote] = await tx
        .insert(jobItemQuotes)
        .values({
        jobQuoteId: input.jobQuoteId,
        jobItemId: input.jobItemId,
        componentsCost: moneyString(preview.componentsCost),
        serviceCharge: typeof input.serviceCharge === 'string'
            ? input.serviceCharge
            : moneyString(serviceChargeAmount),
        totalAmount: moneyString(totalAmount),
        createdByUserId: input.createdByUserId,
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
