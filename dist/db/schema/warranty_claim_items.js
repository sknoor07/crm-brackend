import { pgTable, pgEnum, uuid, varchar, text, timestamp, integer, index, } from "drizzle-orm/pg-core";
import { warrantyClaims } from "./warranty_claims.js";
export const warrantyClaimActionTypeValues = [
    "inspection",
    "repair",
    "replacement",
    "reinstallation",
    "adjustment",
    "no_action",
];
export const warrantyClaimActionType = pgEnum("warranty_claim_action_type", warrantyClaimActionTypeValues);
export const warrantyClaimItems = pgTable("warranty_claim_items", {
    id: uuid("id").defaultRandom().primaryKey(),
    warrantyClaimId: uuid("warranty_claim_id")
        .references(() => warrantyClaims.id, {
        onDelete: "cascade",
    })
        .notNull(),
    actionType: warrantyClaimActionType("action_type")
        .notNull(),
    componentName: varchar("component_name", {
        length: 200,
    }).notNull(),
    quantity: integer("quantity")
        .notNull()
        .default(1),
    description: text("description"),
    createdAt: timestamp("created_at")
        .defaultNow()
        .notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull(),
}, (table) => ({
    claimIdx: index("warranty_claim_items_claim_idx")
        .on(table.warrantyClaimId),
}));
