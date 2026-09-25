# Rollcall — Class Attendance Management System

A database-driven system for recording, managing, monitoring and reporting student attendance, with role-based access for **Administrators**, **Instructors** and **Students**.

**Live demo:** https://marrahsaioalusine-arch.github.io/attendance-tracking-system/

The app runs a real relational database (SQLite compiled to WebAssembly with [sql.js](https://github.com/sql-js/sql.js)) inside the browser, so it works on GitHub Pages with no server, no cloud service and no third-party API. The same design is also provided as **PostgreSQL** scripts in [`database/postgresql`](database/postgresql).

## Demo accounts (simulated data)

| Role | Username | Password |
|---|---|---|
| Administrator | `admin` | `admin123` |
| Instructor | `gchan` (also `dokafor`, `mwong`, `skoroma`) | `teach123` |
| Student | `s2026001` … `s2026030` | `student123` |

Data is saved in your browser's localStorage. **Settings → Reset sample data** restores the original dataset.

## Features

- **User management:** create accounts, assign roles, activate or deactivate users, reset passwords, and enforce role-based permissions. Passwords are stored as salted SHA-256 hashes.
- **Students:** register students, store their ID, name, contact and academic details, then search, filter, update and delete them.
- **Instructors:** keep instructor records, assign them to sections, and let each instructor see only their own classes.
- **Courses and classes:** manage courses, sections, academic terms, classrooms and weekly schedules.
- **Enrollment:** enroll students in sections. Duplicate enrollment and over-capacity enrollment are blocked by the database.
- **Attendance:**
  - Create sessions from each section's weekly schedule.
  - Mark each student Present, Absent, Late or Excused, with a check-in time and remarks.
  - Only the authorized instructor (or an admin) can record or edit a session, and future sessions can't be recorded.
  - A student can have only one record per session.
  - Fast marking: filter the roster, mark with the keyboard (<kbd>P</kbd> <kbd>L</kbd> <kbd>A</kbd> <kbd>E</kbd>, arrow keys to move), or fill every unmarked student as Present or Absent in one click.
  - A warning appears if you try to leave a session with unsaved changes.
  - Every status change is written to an audit log by a trigger. Admins can browse it on the **Audit log** page, filtered by section, user or new status.
- **Student view:**
  - A term calendar heatmap shows each day's attendance at a glance.
  - An **Absences left** column shows how many more classes a student can miss and still finish at or above the threshold.
- **Reports** (each with its SQL shown and CSV export):
  - individual history
  - class summary
  - daily report
  - course statistics
  - attendance percentage
  - absence and lateness
  - students below a threshold (the threshold is configurable)
  - attendance register: a students × sessions grid with P / L / A / E marks
  - every report has a print-friendly layout (Print button)
- **Database tools (admin):**
  - live schema browser with PK/FK, views, triggers and indexes
  - SQL console with sample queries and constraint tests
  - export or import of the `.sqlite` file

## Database design

- The ERD and normalization notes are in [`docs/ERD.md`](docs/ERD.md).
- 15 tables in 3NF, with primary and foreign keys, and `UNIQUE`, `CHECK` and `NOT NULL` constraints.
- Referential actions (`RESTRICT`, `CASCADE`, `SET NULL`).
- Indexes on the most common joins and lookups.
- Views: `v_student_section_attendance`, `v_session_summary`, `v_daily_attendance`, `v_course_statistics`, `v_low_attendance`.
- Triggers:
  - enrollment is required before attendance can be recorded
  - section capacity is enforced
  - status changes are audited
- Transactions: saving a session's attendance, enrollment and every other write runs inside `BEGIN … COMMIT`, and rolls back if anything fails.

### PostgreSQL version

```bash
psql -U postgres -c "CREATE DATABASE cams;"
cd database/postgresql
psql -U postgres -d cams -f 01_schema.sql              # tables, keys, constraints, indexes
psql -U postgres -d cams -f 02_seed.sql                # sample data
psql -U postgres -d cams -f 03_views.sql               # reporting views
psql -U postgres -d cams -f 04_triggers_procedures.sql # triggers, functions, stored procedures
psql -U postgres -d cams -f 05_queries.sql             # CRUD, joins, reports, transactions
```

The procedures are `sp_enroll_student`, `sp_record_attendance` (which checks authorization and rejects future dates), `sp_generate_sessions` and `fn_attendance_pct`.

## Run locally

Browsers block WebAssembly from `file://`, so serve the folder over HTTP:

```bash
git clone https://github.com/marrahsaioalusine-arch/attendance-tracking-system.git
cd attendance-tracking-system
python -m http.server 8000
# open http://localhost:8000
```

## Project structure

```
index.html              App shell
css/styles.css          Dark theme UI
js/schema.js            SQLite schema: tables, indexes, triggers, views
js/seed.js              Simulated sample data + password hashing
js/app.js               Single-page app (routing, roles, CRUD, attendance, reports)
vendor/                 sql.js (SQLite → WebAssembly), vendored — no CDN needed
database/postgresql/    PostgreSQL scripts
docs/ERD.md             ER diagram and 3NF notes
```

## Scope

**In scope:** user management, students, instructors, courses/classes, enrollment, attendance recording, reports, and relational database design.

**Out of scope:** biometrics, GPS, RFID, external/LMS integration, grading, mobile app, AI, SMS/email notifications.

**Constraints:**
- relational DBMS
- simulated data only
- three user roles
- basic security
- no cloud services or third-party APIs
- simple UI, with the academic focus on database design
