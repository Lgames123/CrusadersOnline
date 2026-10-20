-- 008_economy.sql — MMO Stage 4: auction house (buyout), mailbox, economy audit log.
-- (docs/game-design/mmo/05 names it "006": 006 and 007 were taken.) A listed item lives in its
-- listing row (catalogue id, quantity, mods, identity) while in escrow: inventory rows are
-- rewritten on every save, so nothing may point at them.
CREATE TABLE auction_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    seller_name VARCHAR(20) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    item_uid UUID,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    mods JSONB,
    price BIGINT NOT NULL CHECK (price > 0),
    deposit BIGINT NOT NULL CHECK (deposit >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'expired', 'cancelled')),
    buyer_character_id UUID REFERENCES characters(id) ON DELETE SET NULL
);
CREATE INDEX idx_auction_open ON auction_listings(status, expires_at);
CREATE INDEX idx_auction_seller ON auction_listings(seller_character_id, status);

CREATE TABLE mailbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    sender VARCHAR(32) NOT NULL DEFAULT 'Auction Broker',
    subject VARCHAR(80) NOT NULL,
    gold BIGINT NOT NULL DEFAULT 0 CHECK (gold >= 0),
    item_id VARCHAR(64),
    item_uid UUID,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    mods JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mailbox_character ON mailbox(character_id);

CREATE TABLE economy_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(32) NOT NULL,
    character_id UUID,
    other_character_id UUID,
    gold BIGINT NOT NULL DEFAULT 0,
    item_id VARCHAR(64),
    item_uid UUID,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_economy_audit_character ON economy_audit(character_id, created_at);
