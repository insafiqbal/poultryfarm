from app import app
from models import db, User, Category
from sqlalchemy import text

with app.app_context():
    # 0. Fix Schema (Alter columns if they exist but are too short)
    try:
        with db.engine.connect() as conn:
            # SQLite syntax is limited, but this works for Postgres/MySQL. 
            # For SQLite, it ignores checking length usually, but let's try strict alter for Postgres context
            try:
                conn.execute(text('ALTER TABLE "user" ALTER COLUMN password_hash TYPE VARCHAR(512)'))
                conn.execute(text('ALTER TABLE "user" ALTER COLUMN otp_hash TYPE VARCHAR(256)'))
                conn.commit()
                print("✅ Schema updated: password_hash/otp_hash length increased.")
            except Exception as e:
                # If table doesn't exist yet, ignore
                print(f"⚠️ Schema update skipped (table might not exist): {e}")
    except Exception as e:
        print(f"⚠️ Schema update note (ignore if new DB): {e}")

    # 1. Create Tables
    db.create_all()
    print("✅ Tables created successfully")

    # 2. Seed Default User
    admin_email = "insafiqbal2004@gmail.com"
    admin = User.query.filter_by(email=admin_email).first()
    if not admin:
        admin = User(email=admin_email, name="Insaf Iqbal", is_active=True)
        admin.set_password("insaf123")
        db.session.add(admin)
        print(f"✅ Seeded default user: {admin_email}")
    else:
        # Update existing admin if missing name or other fields
        if not admin.name:
            admin.name = "Insaf Iqbal"
        
        # Ensure new security fields are set if they were missing (null)
        if admin.failed_login_attempts is None:
            admin.failed_login_attempts = 0
        if admin.is_locked is None:
            admin.is_locked = False
            
    # 3. Seed Categories
    hima_defaults = ['Chicks', 'Chicken Feed', 'Medicine']
    farm_defaults = ['Labour', 'Food for Labour', 'Electricity', 'Saw Dust (UMI)', 'Wood (Kolli)', 'Additional Cost']
    
    # Ensure Hima defaults exist
    for name in hima_defaults:
        cat = Category.query.filter_by(name=name).first()
        if not cat:
            db.session.add(Category(name=name, is_hima=True))
        else:
            cat.is_hima = True # Enforce ownership

    # Ensure Farm defaults exist
    for name in farm_defaults:
        cat = Category.query.filter_by(name=name).first()
        if not cat:
            db.session.add(Category(name=name, is_hima=False))
        else:
            cat.is_hima = False # Enforce ownership
            
    db.session.commit()
    print("✅ Database seeding complete")
