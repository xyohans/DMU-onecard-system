CREATE DATABASE IF NOT EXISTS meal_card
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE meal_card;

-- STUDENTS (mock of the university data). Each student has ONE cafeteria and ONE gate.
CREATE TABLE students (
  id            VARCHAR(40)  NOT NULL,            -- the ID inside the QR code
  full_name     VARCHAR(150) NOT NULL,
  department    VARCHAR(100) NULL,
  photo_url     VARCHAR(500) NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  cafeteria_id  TINYINT      NULL,                -- 1 or 2
  gate          TINYINT      NULL,                -- 1 to 9
  PRIMARY KEY (id),
  KEY idx_students_gate (cafeteria_id, gate)
) ENGINE=InnoDB;

-- STAFF (accounts are provisioned with api/scripts/create-staff.js)
CREATE TABLE staff (
  id            INT          NOT NULL AUTO_INCREMENT,
  email         VARCHAR(150) NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('staff','admin') NOT NULL DEFAULT 'staff',
  cafeteria_id  TINYINT      NULL,
  gate          TINYINT      NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_email (email),
  KEY idx_staff_station (cafeteria_id, gate)
) ENGINE=InnoDB;

-- A staff account can have only one active phone session.
CREATE TABLE staff_sessions (
  staff_id   INT         NOT NULL,
  token_hash BINARY(32)  NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_id),
  UNIQUE KEY uq_staff_sessions_token (token_hash),
  CONSTRAINT fk_staff_sessions_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- MEAL WINDOWS (daily schedule)
CREATE TABLE meal_windows (
  meal_type   ENUM('breakfast','lunch','dinner') NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  PRIMARY KEY (meal_type),
  CHECK (start_time < end_time)
) ENGINE=InnoDB;

-- WEEKLY MENU (fixed, repeats every week)
CREATE TABLE weekly_menu (
  day_of_week TINYINT NOT NULL,                   -- 1=Mon ... 7=Sun
  meal_type   ENUM('breakfast','lunch','dinner') NOT NULL,
  menu_name   VARCHAR(150) NOT NULL,
  PRIMARY KEY (day_of_week, meal_type),
  CHECK (day_of_week BETWEEN 1 AND 7)
) ENGINE=InnoDB;

-- MEAL LOGS (who ate what, when, and at which gate)
CREATE TABLE meal_logs (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  student_id    VARCHAR(40)  NOT NULL,
  meal_type     ENUM('breakfast','lunch','dinner') NOT NULL,
  meal_date     DATE         NOT NULL,
  scanned_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  method        ENUM('qr','manual') NOT NULL DEFAULT 'qr',
  cafeteria_id  TINYINT      NULL,
  gate          TINYINT      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_meal_date (student_id, meal_type, meal_date),  -- blocks double use
  KEY idx_meal_logs_date (meal_date, meal_type),
  KEY idx_meal_logs_gate (meal_date, cafeteria_id, gate),
  CONSTRAINT fk_logs_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

-- =====================================================
-- SEED DATA (replace with the real values)
-- =====================================================

-- TESTING times: 06:00-12:00 / 12:00:01-18:00 / 18:00:01-23:59:59. Put the real cafeteria times here later.
INSERT INTO meal_windows (meal_type, start_time, end_time) VALUES
('breakfast','06:00:00','12:00:00'),
('lunch',    '12:00:01','18:00:00'),
('dinner',   '18:00:01','23:59:59');

INSERT INTO weekly_menu (day_of_week, meal_type, menu_name) VALUES
(1,'breakfast','Firfir'),          (1,'lunch','Shiro with injera'),   (1,'dinner','Pasta'),
(2,'breakfast','Bread and tea'),   (2,'lunch','Misir wot'),           (2,'dinner','Rice and stew'),
(3,'breakfast','Chechebsa'),       (3,'lunch','Gomen with injera'),   (3,'dinner','Macaroni'),
(4,'breakfast','Bread and egg'),   (4,'lunch','Shiro with injera'),   (4,'dinner','Rice and stew'),
(5,'breakfast','Firfir'),          (5,'lunch','Misir wot'),           (5,'dinner','Pasta'),
(6,'breakfast','Bread and tea'),   (6,'lunch','Beyaynetu'),           (6,'dinner','Rice and stew'),
(7,'breakfast','Chechebsa'),       (7,'lunch','Beyaynetu'),           (7,'dinner','Macaroni');

-- id, full_name, department, photo_url, is_active, cafeteria_id, gate
INSERT INTO students (id, full_name, department, photo_url, is_active, cafeteria_id, gate) VALUES
('DMUUGR1001','Abebe Kebede',  'Software Engineering', NULL, 1, 1, 1),
('DMUUGR1002','Hanna Tesfaye', 'Computer Science',     NULL, 1, 1, 1),
('DMUUGR1003','Dawit Alemu',   'Information Systems',  NULL, 1, 1, 2),
('DMUUGR1004','Selam Girma',   'Software Engineering', NULL, 1, 2, 1),
('DMUUGR1005','Yonas Bekele',  'Computer Science',     NULL, 1, 2, 3),
('DMUUGR1006','Meron Tadesse', 'Information Systems',  NULL, 0, 1, 1);   -- inactive, for testing

-- For testing only: spread existing students evenly over 2 cafeterias x 9 gates
-- UPDATE students s
-- JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn FROM students) t ON t.id = s.id
-- SET s.cafeteria_id = (t.rn % 18) DIV 9 + 1,
--     s.gate = (t.rn % 9) + 1;
