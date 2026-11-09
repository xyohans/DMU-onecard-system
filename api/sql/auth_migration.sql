-- Run once against an existing meal_card database with the original staff table.
-- Back up the database first. This migration adds assignments and one-phone sessions.
ALTER TABLE staff
  ADD COLUMN role ENUM('staff','admin') NOT NULL DEFAULT 'staff',
  ADD COLUMN cafeteria_id TINYINT NULL,
  ADD COLUMN gate TINYINT NULL,
  ADD KEY idx_staff_station (cafeteria_id, gate);

CREATE TABLE staff_sessions (
  staff_id   INT         NOT NULL,
  token_hash BINARY(32)  NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_id),
  UNIQUE KEY uq_staff_sessions_token (token_hash),
  CONSTRAINT fk_staff_sessions_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
) ENGINE=InnoDB;
