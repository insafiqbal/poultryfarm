from flask import Flask, request, jsonify, render_template, redirect, url_for, flash
from flask_cors import CORS
from flask_login import LoginManager, login_user, logout_user, login_required, current_user

from models import db, Batch, Expense, Sale, HimaPayable, Category, Worker, Deposit, Estimate, User
from datetime import datetime
import time
import os
from werkzeug.utils import secure_filename
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import random
import string
import threading
from datetime import timedelta
from email.mime.base import MIMEBase
from email import encoders
from xhtml2pdf import pisa
import io
from flask import make_response

app = Flask(__name__)
# Use a dynamic secret key to invalidate sessions on server restart
app.config['SECRET_KEY'] = os.urandom(24) 
CORS(app)

# Database Configuration
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'instance', 'poultry.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(basedir, 'static', 'uploads', 'receipts')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def save_receipt(file):
    if file and file.filename:
        filename = secure_filename(f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{file.filename}")
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        return f"/static/uploads/receipts/{filename}"
    return None

db.init_app(app)

login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.init_app(app)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

with app.app_context():
    db.create_all()
    

    # 0. Seed Default User
    admin_email = "insafiqbal2004@gmail.com"
    admin = User.query.filter_by(email=admin_email).first()
    if not admin:
        admin = User(email=admin_email, name="Insaf Iqbal", is_active=True)
        admin.set_password("insaf123")
        db.session.add(admin)
        db.session.commit()
        print(f"Seeded default user: {admin_email}")
    else:
        # Update existing admin if missing name
        if not admin.name:
            admin.name = "Insaf Iqbal"
            db.session.commit()
    # Other Schema Migrations
    try:
        with db.engine.connect() as conn:
            # 1. New Table Worker (handled by create_all above)
            # 2. Add columns to Expense
            try:
                conn.execute(text("ALTER TABLE expense ADD COLUMN worker_id INTEGER REFERENCES worker(id)"))
                print("Migrated: Added worker_id to Expense")
            except Exception: pass
            
            try:
                conn.execute(text("ALTER TABLE expense ADD COLUMN is_advance BOOLEAN DEFAULT 0"))
                print("Migrated: Added is_advance to Expense")
            except Exception: pass
            
            # Legacy hima check (keep separate)
            try:
                conn.execute(text("ALTER TABLE category ADD COLUMN is_hima BOOLEAN DEFAULT 0"))
            except Exception: pass

            try:
                conn.execute(text("ALTER TABLE batch ADD COLUMN opening_balance FLOAT DEFAULT 0.0"))
                print("Migrated: Added opening_balance to Batch")
            except Exception: pass

            try:
                conn.execute(text("ALTER TABLE batch ADD COLUMN opening_balance_by VARCHAR(50)"))
                print("Migrated: Added opening_balance_by to Batch")
            except Exception: pass

            try:
                conn.execute(text("CREATE TABLE IF NOT EXISTS deposit (id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL, date DATE NOT NULL, amount FLOAT DEFAULT 0.0, description VARCHAR(200), FOREIGN KEY(batch_id) REFERENCES batch(id))"))
                print("Migrated: Ensure Deposit table exists")
            except Exception: pass

            try:
                conn.execute(text("ALTER TABLE deposit ADD COLUMN deposited_by VARCHAR(50)"))
                print("Migrated: Added deposited_by to Deposit")
            except Exception: pass

            try:
                conn.execute(text("ALTER TABLE deposit ADD COLUMN ref_no VARCHAR(50)"))
                print("Migrated: Added ref_no to Deposit")
            except Exception: pass

            # Receipt URL Migrations
            for table in ['expense', 'sale', 'deposit', 'hima_payable']:
                try:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN receipt_url VARCHAR(300)"))
                    print(f"Migrated: Added receipt_url to {table}")
                except Exception: pass
            
            # Balance Notification Migration
            try:
                conn.execute(text("ALTER TABLE batch ADD COLUMN last_notified_balance FLOAT"))
                print("Migrated: Added last_notified_balance to Batch")
            except Exception: pass

    except Exception as e:
        print(f"Migration Note: {e}")
        pass # Column likely exists or other non-critical error
    
    # Initialize Categories with Ownership (STRICT MODE)
    hima_defaults = ['Chicks', 'Chicken Feed', 'Medicine']
    # Note: 'Saw Dust (UMI)' and 'Additional Cost' order
    farm_defaults = ['Labour', 'Food for Labour', 'Electricity', 'Saw Dust (UMI)', 'Wood (Kolli)', 'Additional Cost']
    
    all_allowed = set(hima_defaults + farm_defaults)

    # 1. Cleanup: Remove any category NOT in the allowed list
    existing_cats = Category.query.all()
    for cat in existing_cats:
        if cat.name not in all_allowed:
            db.session.delete(cat)
            print(f"Deleted unwanted category: {cat.name}")
            
    # 2. Ensure Hima defaults exist
    for name in hima_defaults:
        cat = Category.query.filter_by(name=name).first()
        if not cat:
            db.session.add(Category(name=name, is_hima=True))
        else:
            cat.is_hima = True # Enforce ownership

    # 3. Ensure Farm defaults exist
    for name in farm_defaults:
        cat = Category.query.filter_by(name=name).first()
        if not cat:
            db.session.add(Category(name=name, is_hima=False))
        else:
            cat.is_hima = False # Enforce ownership
            
    db.session.commit()


# --- Email Helper ---
def send_otp_email(to_email, otp, action="password reset"):
    # Retrieve configuration from environment or use provided defaults
    smtp_server = os.environ.get('SMTP_SERVER', 'smtp.gmail.com')
    smtp_port = int(os.environ.get('SMTP_PORT', 587))
    sender_email = os.environ.get('SMTP_EMAIL', 'poultryfarms25@gmail.com')
    sender_password = os.environ.get('SMTP_PASSWORD', 'buck pjmo enys bwqh')

    try:
        msg = MIMEMultipart('alternative')
        msg['From'] = 'Saudi Farms <' + sender_email + '>'
        msg['To'] = to_email
        msg['Subject'] = f'Security OTP: {action.title()}'

        # HTML Content (Posh & Impressive)
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <div style="background-color: #f1f5f9; padding: 40px 20px;">
                <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
                    <!-- Header -->
                    <div style="background-color: #0f172a; padding: 30px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px; font-weight: 600;">
                            Saudi<span style="color: #3b82f6;">Farms</span>
                        </h1>
                    </div>
                    
                    <!-- Content -->
                    <div style="padding: 40px; text-align: center;">
                        <span style="text-transform: uppercase; letter-spacing: 2px; font-size: 11px; font-weight: 700; color: #64748b; display: block; margin-bottom: 10px;">Verification Required</span>
                        <p style="font-size: 16px; color: #1e293b; margin-bottom: 30px; line-height: 1.5;">
                            To complete your request for <strong style="color: #0f172a;">{action}</strong>, please use the following security code:
                        </p>
                        
                        <div style="font-size: 42px; font-weight: 800; color: #0f172a; letter-spacing: 8px; margin: 25px 0; padding: 25px; background-color: #f8fafc; border-radius: 12px; border: 2px dashed #cbd5e1; display: inline-block; width: 80%;">
                            {otp}
                        </div>
                        
                        <p style="color: #ef4444; font-size: 14px; font-weight: 600; margin-top: 25px;">
                            <i style="margin-right: 5px;">&#9201;</i> This code expires in 10 minutes.
                        </p>
                        
                        <div style="margin-top: 40px; padding-top: 25px; border-top: 1px solid #f1f5f9;">
                            <p style="font-size: 13px; color: #94a3b8; line-height: 1.6;">
                                If you did not initiate this request, your account may be at risk. Please ignore this email or contact support if you have concerns.
                            </p>
                        </div>
                    </div>
                    
                    <!-- Footer -->
                    <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                        <p style="font-size: 11px; color: #94a3b8; margin: 0; letter-spacing: 0.5px;">
                            &copy; 2025 Saudi Farms Manager &bull; Excellence in Agriculture
                        </p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """
        
        # Attach both plain and html versions
        plain_text = f"Your OTP for {action} is: {otp}. This code expires in 10 minutes."
        msg.attach(MIMEText(plain_text, 'plain'))
        msg.attach(MIMEText(html_content, 'html'))


        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(sender_email, sender_password)
        text = msg.as_string()
        server.sendmail(sender_email, to_email, text)
        server.quit()
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        return False


@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    if request.method == 'POST':
        # Handle both standard form and JSON for flexibility
        if request.is_json:
            data = request.json
            email = data.get('email')
            password = data.get('password')
        else:
            email = request.form.get('email')
            password = request.form.get('password')

        user = User.query.filter_by(email=email).first()
        
        # 1. Check if user exists
        if not user:
             if request.is_json:
                return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
             flash('Invalid email or password')
             return render_template('login.html')

        # 2. Check Logic Lock
        if user.is_locked:
             error_msg = 'Account locked due to too many failed attempts. Use "Forgot Password" to unlock.'
             if request.is_json:
                return jsonify({'success': False, 'error': error_msg}), 403
             flash(error_msg)
             return render_template('login.html')

        # 3. Verify Password
        if user.check_password(password):
            # Success: Reset counters
            user.failed_login_attempts = 0
            db.session.commit()
            
            login_user(user, remember=False)
            if request.is_json:
                return jsonify({'success': True})
            return redirect(url_for('index'))
        else:
            # Failure: Increment
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            db.session.commit()
            
            if user.failed_login_attempts >= 3:
                user.is_locked = True
                db.session.commit()
                error_msg = 'Account has been locked due to multiple failed attempts.'
                if request.is_json:
                    return jsonify({'success': False, 'error': error_msg}), 403
                flash(error_msg)
            else:
                 # Standard failure message
                 attempts_left = 3 - user.failed_login_attempts
                 error_msg = f'Invalid credentials. {attempts_left} attempts remaining.'
                 if request.is_json:
                    return jsonify({'success': False, 'error': error_msg}), 401
                 flash(error_msg)
        
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    response = make_response(redirect(url_for('login')))
    # Prevent caching to ensure back button forces re-login
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/')
def index():
    if not current_user.is_authenticated:
        return redirect(url_for('login'))
    
    # Add cache headers for main page too
    response = make_response(render_template('index.html'))
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/api/batches/<int:batch_id>/estimate', methods=['GET', 'POST'])
@login_required
def handle_estimate(batch_id):
    import json
    batch = Batch.query.get_or_404(batch_id)
    estimate = Estimate.query.filter_by(batch_id=batch_id).first()
    
    if request.method == 'GET':
        if not estimate:
            return jsonify({}), 404
        return jsonify(estimate.to_dict())
    
    data = request.json
    if not estimate:
        estimate = Estimate(batch_id=batch_id)
        db.session.add(estimate)
    
    # Update fields
    estimate.birds = float(data.get('birds', 0.0))
    estimate.weight = float(data.get('weight', 0.0))
    estimate.price = float(data.get('price', 0.0))
    estimate.chick_qty = float(data.get('chick_qty', 0.0))
    estimate.chick_unit_price = float(data.get('chick_unit_price', 0.0))
    estimate.chick_cost = float(data.get('chick_cost', 0.0))
    estimate.medicine = float(data.get('medicine', 0.0))
    estimate.feed_bags = float(data.get('feed_bags', 0.0))
    estimate.feed_price = float(data.get('feed_price', 0.0))
    estimate.labour = float(data.get('labour', 0.0))
    estimate.food_labour = float(data.get('food_labour', 0.0))
    estimate.saw_dust = float(data.get('saw_dust', 0.0))
    estimate.wood = float(data.get('wood', 0.0))
    estimate.other_cost = float(data.get('other_cost', 0.0))
    
    # Store JSON strings
    estimate.extra_expenses = json.dumps(data.get('extra_expenses', []))
    estimate.hima_payables = json.dumps(data.get('hima_payables', []))
    
    db.session.commit()
    return jsonify(estimate.to_dict())

@app.route('/api/batches', methods=['GET'])
@login_required
def get_batches():
    batches = Batch.query.order_by(Batch.start_date.desc()).all()
    return jsonify([b.to_dict() for b in batches])

@app.route('/api/batches', methods=['POST'])
@login_required
def create_batch():
    data = request.json
    try:
        start_date = datetime.strptime(data['start_date'], '%Y-%m-%d').date() if 'start_date' in data else datetime.utcnow().date()
        new_batch = Batch(
            name=data['name'], 
            start_date=start_date,
            opening_balance=float(data.get('opening_balance', 0.0))
        )
        db.session.add(new_batch)
        db.session.commit()
        return jsonify(new_batch.to_dict()), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/batches/<int:batch_id>', methods=['GET', 'PATCH'])
@login_required
def update_batch(batch_id):
    batch = Batch.query.get_or_404(batch_id)
    
    def get_response_with_breakdown():
        resp = batch.to_dict()
        # Fetch Opening Breakdown
        ops = Deposit.query.filter_by(batch_id=batch_id, ref_no='OPENING_BALANCE').all()
        
        # New Detailed Structure
        detailed_data = [] 
        obs_date = batch.start_date.isoformat() if batch.start_date else None
        
        breakdown_map = { 'Farm': 0, 'Kaleel': 0, 'Iqbal': 0, 'Farhan': 0 }

        if ops:
            # Use date from first record
            check_date = ops[0].date
            if check_date:
                obs_date = check_date.isoformat()
                
            for d in ops:
                detailed_data.append({
                    'provider': d.deposited_by,
                    'amount': d.amount,
                    'ref': d.description # We can store Ref in Description
                })
                if d.deposited_by in breakdown_map:
                    breakdown_map[d.deposited_by] += d.amount
        
        # Fallback for old migration
        if not ops and batch.opening_balance > 0:
            who = batch.opening_balance_by if batch.opening_balance_by in breakdown_map else 'Farm'
            breakdown_map[who] = batch.opening_balance
            detailed_data.append({'provider': who, 'amount': batch.opening_balance, 'ref': str(batch.id)})

        resp['opening_balance_breakdown'] = breakdown_map # Simple Map for Summary
        resp['opening_balance_data'] = {
            'date': obs_date,
            'items': detailed_data
        }
        return jsonify(resp)

    if request.method == 'GET':
        return get_response_with_breakdown()
    
    data = request.json
    
    if 'status' in data:
        new_status = data['status']
        
        # Security: OTP Check for critical status changes (Active <-> Closed)
        if new_status in ['Closed', 'Active'] and batch.status != new_status:
            otp = data.get('otp')
            if not otp:
                return jsonify({'error': 'OTP Required for this action'}), 400
                
            if not current_user.otp_hash or not current_user.otp_expiry:
                return jsonify({'error': 'OTP not requested'}), 400
                
            if datetime.utcnow() > current_user.otp_expiry:
                return jsonify({'error': 'OTP expired'}), 400
                
            if current_user.otp_hash != otp:
                return jsonify({'error': 'Invalid OTP'}), 400
            
            # Consume OTP
            current_user.otp_hash = None
            current_user.otp_expiry = None

        if new_status == 'Closed' and batch.status != 'Closed':
            # Trigger report distribution to all users
            threading.Thread(target=send_closed_batch_report, args=(batch.id,)).start()

        batch.status = new_status
        if new_status == 'Closed' and 'end_date' in data:
            try:
                batch.end_date = datetime.strptime(data['end_date'], '%Y-%m-%d').date()
            except ValueError:
                return jsonify({'error': 'Invalid date format'}), 400
        elif new_status == 'Active':
            batch.end_date = None
            
    if 'hima_percent' in data:
        batch.hima_percent = float(data['hima_percent'])
        
    if 'opening_balance' in data:
        try:
            batch.opening_balance = float(data['opening_balance'])
        except: pass

    if 'opening_balance_by' in data:
        batch.opening_balance_by = data['opening_balance_by']
        
    if 'opening_balance_payload' in data:
        payload = data['opening_balance_payload']
        obs_date_str = payload.get('date')
        items = payload.get('items', [])
        
        obs_date = batch.start_date
        if obs_date_str:
            try:
                obs_date = datetime.strptime(obs_date_str, '%Y-%m-%d').date()
            except: pass
            
        # 1. Clear old
        Deposit.query.filter_by(batch_id=batch.id, ref_no='OPENING_BALANCE').delete()
        
        # 2. Create new
        total_opening = 0
        for item in items:
            amt = float(item.get('amount', 0))
            if amt > 0:
                d = Deposit(
                    batch_id=batch.id,
                    date=obs_date,
                    ref_no='OPENING_BALANCE',
                    description=item.get('ref', 'Opening Balance'),
                    amount=amt,
                    deposited_by=item.get('provider', 'Farm'),

                )
                db.session.add(d)
                total_opening += amt
        batch.opening_balance = total_opening

    elif 'opening_balance_breakdown' in data:
        breakdown = data['opening_balance_breakdown']
        
        # 1. Update Batch Total
        total_opening = sum(float(val) for val in breakdown.values() if val)
        batch.opening_balance = total_opening
        
        # 2. Manage Speciail Deposits
        # Clear existing
        Deposit.query.filter_by(batch_id=batch_id, ref_no='OPENING_BALANCE').delete()
        
        # Add new
        for who, amount in breakdown.items():
            if amount and float(amount) > 0:
                new_dep = Deposit(
                    batch_id=batch_id,
                    date=batch.start_date,
                    amount=float(amount),
                    description='Opening Balance',
                    deposited_by=who,
                    ref_no='OPENING_BALANCE'
                )
                db.session.add(new_dep)
    

    db.session.commit()
    return get_response_with_breakdown()

@app.route('/api/batches/<int:batch_id>', methods=['DELETE'])
@login_required
def delete_batch(batch_id):
    batch = Batch.query.get_or_404(batch_id)
    data = request.json
    otp = data.get('otp')
    
    if not otp:
        return jsonify({'error': 'OTP Required to delete a batch'}), 400
        
    if not current_user.otp_hash or not current_user.otp_expiry:
        return jsonify({'error': 'OTP not requested'}), 400
        
    if datetime.utcnow() > current_user.otp_expiry:
        return jsonify({'error': 'OTP expired'}), 400
        
    if current_user.otp_hash != otp:
        return jsonify({'error': 'Invalid OTP'}), 400

    # Consume OTP
    current_user.otp_hash = None
    current_user.otp_expiry = None
    
    db.session.delete(batch)
    db.session.commit()
    return jsonify({'message': 'Batch deleted successfully'}), 200

@app.route('/api/request-action-otp', methods=['POST'])
@login_required
def request_action_otp():
    # Generic OTP request for critical actions (End Batch, Reopen Batch, Delete Batch)
    email = current_user.email
    action = request.json.get('action', 'perform action')
    
    otp = ''.join(random.choices(string.digits, k=6))
    current_user.otp_hash = otp 
    current_user.otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    db.session.commit()
    
    try:
        # Reusing existing helper which handles config
        if send_otp_email(email, otp, action=action):
             return jsonify({'message': 'OTP sent'})
        else:
             return jsonify({'error': 'Failed to send email via SMTP'}), 500
    except Exception as e:
        print(f"Failed to send email: {e}")
        return jsonify({'error': 'Failed to send email'}), 500

def _get_batch_summary_data(batch_id):
    batch = Batch.query.get_or_404(batch_id)
    all_expenses = Expense.query.filter_by(batch_id=batch_id).all()
    expenses = [e for e in all_expenses if not e.is_advance]
    advances = [e for e in all_expenses if e.is_advance]
    total_advances = sum(e.total for e in advances)
    sales = Sale.query.filter_by(batch_id=batch_id).all()
    payables = HimaPayable.query.filter_by(batch_id=batch_id).all()
    
    hima_cats_db = Category.query.filter_by(is_hima=True).all()
    hima_categories = [c.name for c in hima_cats_db]
    
    hima_expenses_total = 0
    farm_expenses_total = 0
    hima_breakdown = {}
    farm_breakdown = {}

    for e in expenses:
        if e.category in hima_categories:
            hima_expenses_total += e.total
            hima_breakdown[e.category] = hima_breakdown.get(e.category, 0) + e.total
        else:
            farm_expenses_total += e.total
            farm_breakdown[e.category] = farm_breakdown.get(e.category, 0) + e.total

    payables_total = 0
    payables_breakdown = {}
    for p in payables:
        payables_total += p.amount
        payables_breakdown[p.name] = payables_breakdown.get(p.name, 0) + p.amount

    deposits = Deposit.query.filter_by(batch_id=batch_id).all()
    total_deposits = sum(d.amount for d in deposits)
    
    # Correction: If Total Deposits is 0 but Batch has legacy opening balance, use that
    # This ensures backend math matches frontend/logic expectation
    if total_deposits == 0 and batch.opening_balance > 0:
        total_funds = batch.opening_balance
    else:
        total_funds = total_deposits
        
    total_sales = sum(s.total_amount for s in sales)
    gross_profit = total_sales - hima_expenses_total
    
    hima_p = batch.hima_percent
    farm_p = 100 - hima_p
    
    hima_share = gross_profit * (hima_p / 100.0)
    farm_share_gross = gross_profit * (farm_p / 100.0)
    
    final_hima_profit = hima_share + payables_total
    final_farm_profit = farm_share_gross - farm_expenses_total - payables_total
    partner_share = final_farm_profit / 3.0

    dep_k = sum(d.amount for d in deposits if d.deposited_by == 'Kaleel')
    dep_i = sum(d.amount for d in deposits if d.deposited_by == 'Iqbal')
    dep_f = sum(d.amount for d in deposits if d.deposited_by == 'Farhan')

    adj_k = dep_k - (dep_i / 2) - (dep_f / 2)
    adj_i = dep_i - (dep_k / 2) - (dep_f / 2)
    adj_f = dep_f - (dep_k / 2) - (dep_i / 2)

    return {
        'batch': batch,
        'all_expenses': all_expenses,
        'expenses': expenses,
        'advances': advances,
        'sales': sales,
        'payables': payables,
        'deposits': deposits,
        'total_sales': total_sales,
        'hima_expenses': hima_expenses_total,
        'farm_expenses': farm_expenses_total,
        'total_deposits': total_deposits,
        'total_funds': total_funds,
        'total_advances': total_advances,
        'payables_total': payables_total,
        'hima_breakdown': hima_breakdown,
        'farm_breakdown': farm_breakdown,
        'payables_breakdown': payables_breakdown,
        'gross_profit': gross_profit,
        'hima_p': hima_p,
        'farm_p': farm_p,
        'hima_share': hima_share,
        'farm_share_gross': farm_share_gross,
        'final_hima_profit': final_hima_profit,
        'final_farm_profit': final_farm_profit,
        'partner_share': partner_share,
        'adj_k': adj_k, 'adj_i': adj_i, 'adj_f': adj_f,
        'dep_k': dep_k, 'dep_i': dep_i, 'dep_f': dep_f,
        'payables_list': [p.to_dict() for p in payables]
    }

@app.route('/api/batches/<int:batch_id>/summary', methods=['GET'])
@login_required
def get_batch_summary(batch_id):
    data = _get_batch_summary_data(batch_id)
    return jsonify({
        'total_sales': data['total_sales'],
        'hima_expenses': data['hima_expenses'],
        'farm_expenses': data['farm_expenses'],
        'total_deposits': data['total_deposits'],
        'total_funds': data['total_funds'],
        'total_advances': data['total_advances'],
        'payables_total': data['payables_total'],
        'hima_breakdown': data['hima_breakdown'],
        'farm_breakdown': data['farm_breakdown'],
        'payables_breakdown': data['payables_breakdown'],
        'gross_profit': data['gross_profit'],
        'hima_p': data['hima_p'],
        'farm_p': data['farm_p'],
        'hima_share': data['hima_share'],
        'farm_share_gross': data['farm_share_gross'],
        'final_hima_profit': data['final_hima_profit'],
        'final_farm_profit': data['final_farm_profit'],
        'partner_share': data['partner_share'],
        'capital_adjustments': {
            'kaleel': data['adj_k'],
            'iqbal': data['adj_i'],
            'farhan': data['adj_f'],
            'deposits': {'kaleel': data['dep_k'], 'iqbal': data['dep_i'], 'farhan': data['dep_f']}
        },
        'final_payouts': {
            'kaleel': data['partner_share'] + data['adj_k'],
            'iqbal': data['partner_share'] + data['adj_i'],
            'farhan': data['partner_share'] + data['adj_f']
        },
        'payables_list': data.get('payables_list', [])
    })

def _generate_batch_report_pdf(batch_id):
    data = _get_batch_summary_data(batch_id)
    batch = data['batch']
    
    # Calculate Age
    start = batch.start_date
    end = batch.end_date if batch.status == 'Closed' and batch.end_date else datetime.now().date()
    
    # Ensure they are date objects for subtraction
    if isinstance(start, datetime): start = start.date()
    if isinstance(end, datetime): end = end.date()
    
    age = (end - start).days
    
    html = render_template('report_template.html', 
                          data=data, 
                          batch=batch, 
                          age=age,
                          now=datetime.now().strftime('%Y-%m-%d %H:%M'))
    
    pdf = io.BytesIO()
    pisa_status = pisa.CreatePDF(io.BytesIO(html.encode("utf-8")), dest=pdf)
    
    if pisa_status.err:
        return None, "Error creating PDF"
        
    return pdf.getvalue(), None

def send_closed_batch_report(batch_id):
    with app.app_context():
        batch = Batch.query.get(batch_id)
        if not batch: return
        
        pdf_content, error = _generate_batch_report_pdf(batch_id)
        if error:
            print(f"Failed to generate report for email: {error}")
            return

        users = User.query.filter_by(is_active=True).all()
        recipient_emails = [u.email for u in users]
        
        if not recipient_emails: return

        smtp_server = os.environ.get('SMTP_SERVER', 'smtp.gmail.com')
        smtp_port = int(os.environ.get('SMTP_PORT', 587))
        sender_email = os.environ.get('SMTP_EMAIL', 'poultryfarms25@gmail.com')
        sender_password = os.environ.get('SMTP_PASSWORD', 'buck pjmo enys bwqh')

        subject = f"Saudi Farms: Final Report for Batch {batch.name}"
        filename = f"Final_Report_{batch.name.replace(' ', '_')}.pdf"

        for to_email in recipient_emails:
            try:
                msg = MIMEMultipart()
                msg['From'] = f"Saudi Farms Audit <{sender_email}>"
                msg['To'] = to_email
                msg['Subject'] = subject

                body = f"""
                <html>
                <body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6;">
                    <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                        <div style="background-color: #0f172a; padding: 30px; text-align: center;">
                            <h2 style="color: #ffffff; margin: 0;">Saudi<span style="color: #3b82f6;">Farms</span></h2>
                        </div>
                        <div style="padding: 40px;">
                            <h3 style="color: #0f172a; margin-top: 0;">Final Batch Settlement Ready</h3>
                            <p>Hello,</p>
                            <p>This is an automated notification that <strong>Batch: {batch.name}</strong> has been officially closed and finalized. </p>
                            <p>Please find the comprehensive financial audit and settlement report attached to this email for your records.</p>
                            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #3b82f6; margin: 25px 0;">
                                <strong>Batch Details:</strong><br/>
                                Reference: {batch.name}<br/>
                                Closed On: {batch.end_date or datetime.now().date()}
                            </div>
                            <p>Thank you for your partnership.</p>
                        </div>
                        <div style="background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8;">
                            &copy; 2025 Saudi Farms Management System &bull; Confidential Record
                        </div>
                    </div>
                </body>
                </html>
                """
                msg.attach(MIMEText(body, 'html'))

                # Attachment
                part = MIMEBase('application', 'octet-stream')
                part.set_payload(pdf_content)
                encoders.encode_base64(part)
                part.add_header('Content-Disposition', f'attachment; filename="{filename}"')
                msg.attach(part)

                server = smtplib.SMTP(smtp_server, smtp_port)
                server.starttls()
                server.login(sender_email, sender_password)
                server.sendmail(sender_email, to_email, msg.as_string())
                server.quit()
                print(f"Sent closed report to {to_email}")
            except Exception as e:
                print(f"Failed to send report to {to_email}: {e}")

@app.route('/api/batches/<int:batch_id>/report', methods=['GET'])
@login_required
def download_batch_report(batch_id):
    pdf_content, error = _generate_batch_report_pdf(batch_id)
    if error:
        return error, 500
        
    batch = Batch.query.get(batch_id) # Need for filename
    response = make_response(pdf_content)
    response.headers['Content-Type'] = 'application/pdf'
    filename = f"Batch_Report_{batch.name.replace(' ', '_')}.pdf"
    response.headers['Content-Disposition'] = f'attachment; filename={filename}'
    return response


# API Endpoints for Expenses
@app.route('/api/batches/<int:batch_id>/expenses', methods=['GET'])
@login_required
def get_expenses(batch_id):
    expenses = Expense.query.filter_by(batch_id=batch_id).all()
    return jsonify([e.to_dict() for e in expenses])

@app.route('/api/expenses', methods=['POST'])
@login_required
def add_expense():
    if request.is_json:
        data = request.json
    else:
        data = request.form
        
    try:
        date_obj = datetime.strptime(data['date'], '%Y-%m-%d').date()
        
        worker_id = data.get('worker_id')
        if worker_id == '' or worker_id is None or str(worker_id).lower() == 'null': 
            worker_id = None
        else:
            try: worker_id = int(worker_id)
            except: worker_id = None
        
        receipt_url = None
        if 'receipt' in request.files:
            receipt_url = save_receipt(request.files['receipt'])

        new_expense = Expense(
            batch_id=int(data['batch_id']),
            category=data['category'],
            ref_no=data.get('ref_no', ''),
            date=date_obj,
            subject=data.get('subject', ''),
            qty=float(data.get('qty', 0) or 0),
            unit_price=float(data.get('unit_price', 0) or 0),
            total=float(data.get('total', 0) or 0),
            worker_id=worker_id,
            is_advance=str(data.get('is_advance', 'false')).lower() == 'true',
            receipt_url=receipt_url
        )
        db.session.add(new_expense)
        db.session.commit()
        return jsonify(new_expense.to_dict()), 201
    except Exception as e:
        print(f"Error creating expense: {e}") 
        return jsonify({'error': str(e)}), 400

@app.route('/api/expenses/<int:expense_id>', methods=['PUT'])
@login_required
def update_expense(expense_id):
    expense = Expense.query.get_or_404(expense_id)
    if request.is_json:
        data = request.json
    else:
        data = request.form

    try:
        if 'date' in data: expense.date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        if 'ref_no' in data: expense.ref_no = data['ref_no']
        if 'subject' in data: expense.subject = data['subject']
        if 'category' in data: expense.category = data['category']
        if 'qty' in data: expense.qty = float(data['qty']) if data['qty'] else 0.0
        if 'unit_price' in data: expense.unit_price = float(data['unit_price']) if data['unit_price'] else 0.0
        if 'total' in data: expense.total = float(data['total'])
        if 'worker_id' in data: 
            wid = data.get('worker_id')
            expense.worker_id = int(wid) if (wid and str(wid).lower() != 'null' and str(wid) != '') else None
        if 'is_advance' in data: expense.is_advance = str(data['is_advance']).lower() == 'true'
        
        if 'receipt' in request.files:
            expense.receipt_url = save_receipt(request.files['receipt'])
        
        db.session.commit()
        return jsonify(expense.to_dict()), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/expenses/<int:expense_id>', methods=['DELETE'])
@login_required
def delete_expense(expense_id):
    expense = Expense.query.get_or_404(expense_id)
    db.session.delete(expense)
    db.session.commit()
    return jsonify({'message': 'Expense deleted'}), 200

# API Endpoints for Sales
@app.route('/api/batches/<int:batch_id>/sales', methods=['GET'])
@login_required
def get_sales(batch_id):
    sales = Sale.query.filter_by(batch_id=batch_id).all()
    return jsonify([s.to_dict() for s in sales])

@app.route('/api/sales', methods=['POST'])
@login_required
def add_sale():
    if request.is_json:
        data = request.json
    else:
        data = request.form
    try:
        date_obj = datetime.strptime(data['date'], '%Y-%m-%d').date()
        
        receipt_url = None
        if 'receipt' in request.files:
            receipt_url = save_receipt(request.files['receipt'])

        new_sale = Sale(
            batch_id=int(data['batch_id']),
            date=date_obj,
            load_name=data.get('load_name', ''),
            qty_birds=int(data.get('qty_birds', 0)),
            weight_kg=float(data.get('weight_kg', 0)),
            price_per_kg=float(data.get('price_per_kg', 0)),
            total_amount=float(data.get('total_amount', 0)),
            receipt_url=receipt_url
        )
        db.session.add(new_sale)
        db.session.commit()
        return jsonify(new_sale.to_dict()), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/sales/<int:sale_id>', methods=['DELETE'])
@login_required
def delete_sale(sale_id):
    sale = Sale.query.get_or_404(sale_id)
    db.session.delete(sale)
    db.session.commit()
    return jsonify({'message': 'Sale deleted'}), 200

@app.route('/api/sales/<int:sale_id>', methods=['PUT'])
@login_required
def update_sale(sale_id):
    sale = Sale.query.get_or_404(sale_id)
    if request.is_json:
        data = request.json
    else:
        data = request.form
    try:
        if 'date' in data: sale.date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        if 'load_name' in data: sale.load_name = data['load_name']
        if 'qty_birds' in data: sale.qty_birds = int(data['qty_birds'])
        if 'weight_kg' in data: sale.weight_kg = float(data['weight_kg'])
        if 'price_per_kg' in data: sale.price_per_kg = float(data['price_per_kg'])
        if 'total_amount' in data: sale.total_amount = float(data['total_amount'])
        
        if 'receipt' in request.files:
            sale.receipt_url = save_receipt(request.files['receipt'])

        db.session.commit()
        return jsonify(sale.to_dict()), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400



# API Endpoints for Hima Payables
@app.route('/api/payables', methods=['POST'])
@login_required
def add_payable():
    if request.is_json:
        data = request.json
    else:
        data = request.form
    try:
        receipt_url = None
        if 'receipt' in request.files:
            receipt_url = save_receipt(request.files['receipt'])

        new_payable = HimaPayable(
            batch_id=int(data['batch_id']),
            name=data['name'],
            amount=float(data['amount']),
            receipt_url=receipt_url
        )
        db.session.add(new_payable)
        db.session.commit()
        return jsonify(new_payable.to_dict()), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

    db.session.delete(payable)
    db.session.commit()
    return jsonify({'message': 'Payable deleted'}), 200

# API Endpoints for Deposits
@app.route('/api/batches/<int:batch_id>/deposits', methods=['GET'])
@login_required
def get_deposits(batch_id):
    deposits = Deposit.query.filter_by(batch_id=batch_id).order_by(Deposit.date.desc()).all()
    return jsonify([d.to_dict() for d in deposits])

@app.route('/api/deposits', methods=['POST'])
@login_required
def add_deposit():
    if request.is_json:
        data = request.json
    else:
        data = request.form
    try:
        date_obj = datetime.strptime(data['date'], '%Y-%m-%d').date()
        
        receipt_url = None
        if 'receipt' in request.files:
            receipt_url = save_receipt(request.files['receipt'])

        new_deposit = Deposit(
            batch_id=int(data['batch_id']),
            date=date_obj,
            amount=float(data['amount']),
            description=data.get('description', ''),
            deposited_by=data.get('deposited_by', ''),
            ref_no=data.get('ref_no', ''),
            receipt_url=receipt_url
        )
        db.session.add(new_deposit)
        db.session.commit()
        return jsonify(new_deposit.to_dict()), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/deposits/<int:deposit_id>', methods=['DELETE'])
@login_required
def delete_deposit(deposit_id):
    deposit = Deposit.query.get_or_404(deposit_id)
    batch = Batch.query.get(deposit.batch_id)
    
    # If this was an opening balance record, sync the batch total
    if deposit.ref_no == 'OPENING_BALANCE' and batch:
        batch.opening_balance = max(0, batch.opening_balance - deposit.amount)
        
    db.session.delete(deposit)
    db.session.commit()
    return jsonify({'message': 'Deposit deleted'}), 200

# API Endpoints for Categories
@app.route('/api/categories', methods=['GET'])
@login_required
def get_categories():
    categories = Category.query.all()
    
    # Custom Sort Order
    order_map = {
        'Chicks': 1, 
        'Chicken Feed': 2, 
        'Medicine': 3,
        'Labour': 4, 
        'Food for Labour': 5, 
        'Electricity': 6, 
        'Saw Dust (UMI)': 7, 
        'Wood (Kolli)': 8,
        'Additional Cost': 9
    }
    
    # Sort by map (unknowns go to end with 999)
    categories.sort(key=lambda c: order_map.get(c.name, 999))
    
    return jsonify([c.to_dict() for c in categories])

@app.route('/api/categories', methods=['POST'])
@login_required
def add_category():
    data = request.json
    name = data.get('name')
    is_hima = data.get('is_hima', False)
    
    if not name:
        return jsonify({'error': 'Name required'}), 400
    
    if Category.query.filter_by(name=name).first():
        return jsonify({'error': 'Category already exists'}), 400
        
    try:
        new_cat = Category(name=name, is_hima=is_hima)
        db.session.add(new_cat)
        db.session.commit()
        return jsonify(new_cat.to_dict()), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

# --- Worker API ---
@app.route('/api/workers', methods=['GET'])
@login_required
def get_workers():
    # Return ALL workers (Active & Inactive) for management
    workers = Worker.query.all()
    return jsonify([w.to_dict() for w in workers])

@app.route('/api/workers', methods=['POST'])
@login_required
def create_worker():
    data = request.json
    if not data or 'name' not in data:
        return jsonify({'error': 'Name is required'}), 400
    
    name = data['name'].strip()
    if Worker.query.filter_by(name=name).first():
        return jsonify({'error': 'Worker with this name already exists'}), 400
    
    dob = datetime.strptime(data['dob'], '%Y-%m-%d').date() if data.get('dob') else None
    
    new_worker = Worker(
        name=name,
        dob=dob,
        phone=data.get('phone'),
        address=data.get('address'),
        emp_id=data.get('emp_id')
    )
    db.session.add(new_worker)
    db.session.commit()
    return jsonify(new_worker.to_dict()), 201

@app.route('/api/workers/<int:worker_id>', methods=['PUT'])
@login_required
def update_worker(worker_id):
    worker = Worker.query.get_or_404(worker_id)
    data = request.json
    
    try:
        if 'name' in data: worker.name = data['name']
        if 'phone' in data: worker.phone = data['phone']
        if 'address' in data: worker.address = data['address']
        if 'emp_id' in data: worker.emp_id = data['emp_id']
        if 'active' in data: worker.active = bool(data['active'])
        
        if 'dob' in data:
            worker.dob = datetime.strptime(data['dob'], '%Y-%m-%d').date() if data['dob'] else None

        db.session.commit()
        return jsonify(worker.to_dict()), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/workers/<int:worker_id>', methods=['DELETE'])
@login_required
def delete_worker(worker_id):
    worker = Worker.query.get_or_404(worker_id)
    try:
        # Optional: Check if expenses exist? 
        # For now, let's just delete. If FK constraints exist, it might fail or cascade.
        # Given simpler requirements, standard delete is fine.
        db.session.delete(worker)
        db.session.commit()
        return jsonify({'message': 'Worker deleted'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

# --- User Management API ---
@app.route('/api/users', methods=['GET'])
@login_required
def get_users():
    users = User.query.all()
    return jsonify([u.to_dict() for u in users])

@app.route('/api/users', methods=['POST'])
@login_required
def create_user():
    data = request.json
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Email and password are required'}), 400
    
    email = data['email'].strip()
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'User with this email already exists'}), 400
    
    new_user = User(
        email=email,
        name=data.get('name', '').strip(),
        is_active=True
    )
    new_user.set_password(data['password'])
    db.session.add(new_user)
    db.session.commit()
    return jsonify(new_user.to_dict()), 201

@app.route('/api/users/<int:user_id>', methods=['PUT'])
@login_required
def update_user(user_id):
    user = User.query.get_or_404(user_id)
    data = request.json
    
    if 'name' in data: user.name = data['name'].strip()
    if 'email' in data:
        email = data['email'].strip()
        existing = User.query.filter_by(email=email).first()
        if existing and existing.id != user_id:
            return jsonify({'error': 'Email already in use'}), 400
        user.email = email
    
    db.session.commit()
    return jsonify(user.to_dict())

@app.route('/api/users/<int:user_id>/toggle', methods=['PATCH'])
@login_required
def toggle_user_status(user_id):
    user = User.query.get_or_404(user_id)
    # Prevent self-disabling? Optional but good.
    if user.id == current_user.id:
        return jsonify({'error': 'You cannot disable your own account'}), 400
    
    user.is_active = not user.is_active
    db.session.commit()
    return jsonify(user.to_dict())

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        return jsonify({'error': 'You cannot delete your own account'}), 400
    
    db.session.delete(user)
    db.session.commit()
    return jsonify({'message': 'User deleted'})

@app.route('/api/change-password/request-otp', methods=['POST'])
@login_required
def request_change_password_otp():
    # Use current_user email
    email = current_user.email
    
    otp = ''.join(random.choices(string.digits, k=6))
    current_user.otp_hash = otp 
    current_user.otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    db.session.commit()
    
    if send_otp_email(email, otp, action="password change"):
        return jsonify({'message': 'OTP sent'})
    else:
        return jsonify({'error': 'Failed to send email'}), 500

@app.route('/api/change-password/confirm', methods=['POST'])
@login_required
def confirm_change_password():
    data = request.json
    otp = data.get('otp')
    new_password = data.get('new_password')
    
    if not otp or not new_password:
        return jsonify({'error': 'Missing fields'}), 400
        
    if not current_user.otp_hash or not current_user.otp_expiry:
        return jsonify({'error': 'OTP not requested'}), 400
        
    if datetime.utcnow() > current_user.otp_expiry:
        return jsonify({'error': 'OTP expired'}), 400
        
    if current_user.otp_hash != otp:
        return jsonify({'error': 'Invalid OTP'}), 400
        
    current_user.set_password(new_password)
    current_user.otp_hash = None
    current_user.otp_expiry = None
    db.session.commit()
    
    return jsonify({'message': 'Password changed successfully'})

@app.route('/api/request-reset', methods=['POST'])
def request_reset():
    data = request.json
    email = data.get('email')
    user = User.query.filter_by(email=email).first()
    
    if not user:
        # Security: Don't reveal if user exists
        return jsonify({'message': 'If account exists, OTP sent'})
    
    # Generate 6-digit OTP
    otp = ''.join(random.choices(string.digits, k=6))
    
    # Store plain OTP for simplicity in this context (for production, hash it)
    user.otp_hash = otp 
    user.otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    db.session.commit()
    
    if send_otp_email(email, otp, action="password reset"):
        return jsonify({'message': 'OTP sent'})
    else:
        return jsonify({'error': 'Failed to send email. Check server logs.'}), 500

@app.route('/api/confirm-reset', methods=['POST'])
def confirm_reset():
    data = request.json
    email = data.get('email')
    otp = data.get('otp')
    new_password = data.get('new_password')
    
    user = User.query.filter_by(email=email).first()
    
    if not user or not user.otp_hash or not user.otp_expiry:
        return jsonify({'error': 'Invalid request'}), 400
        
    if datetime.utcnow() > user.otp_expiry:
        return jsonify({'error': 'OTP expired'}), 400
        
    if user.otp_hash != otp:
        return jsonify({'error': 'Invalid OTP'}), 400
        
    # Reset Password
    user.set_password(new_password)
    user.otp_hash = None
    user.otp_expiry = None
    user.is_locked = False
    user.failed_login_attempts = 0
    db.session.commit()
    
    return jsonify({'message': 'Password reset successful'})

# --- Background Balance Checker ---
def send_balance_update_email(batch_name, current_balance, previous_balance, recipients):
    smtp_server = os.environ.get('SMTP_SERVER', 'smtp.gmail.com')
    smtp_port = int(os.environ.get('SMTP_PORT', 587))
    sender_email = os.environ.get('SMTP_EMAIL', 'poultryfarms25@gmail.com')
    sender_password = os.environ.get('SMTP_PASSWORD', 'buck pjmo enys bwqh')

    subject = f"Saudi Farms: Balance Update for {batch_name}"
    
    change = current_balance - (previous_balance if previous_balance is not None else 0)
    change_str = f"+{change:,.2f}" if change >= 0 else f"{change:,.2f}"
    
    body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
            <div style="background: #3b82f6; color: white; padding: 20px; text-align: center;">
                <h2 style="margin:0;">Balance Update</h2>
            </div>
            <div style="padding: 20px;">
                <p>Hello,</p>
                <p>The remaining balance for batch <strong>{batch_name}</strong> has been updated.</p>
                
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
                    <p style="margin: 0; font-size: 0.9rem; color: #64748b;">Current Remaining Balance</p>
                    <h1 style="margin: 5px 0 0 0; color: #3b82f6; font-size: 2.5rem;">Rs. {current_balance:,.2f}</h1>
                    <p style="margin: 10px 0 0 0; font-size: 0.9rem; color: {'#10b981' if change >= 0 else '#ef4444'};">
                        Change: {change_str}
                    </p>
                </div>

                <p>Login to the dashboard for full details.</p>
                <a href="http://localhost:5000" style="display: inline-block; background: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Go to Dashboard</a>
            </div>
            <div style="background: #f1f5f9; padding: 10px; text-align: center; font-size: 0.8rem; color: #64748b;">
                &copy; {datetime.now().year} Saudi Farms Manager
            </div>
        </div>
      </body>
    </html>
    """

    for to_email in recipients:
        try:
            msg = MIMEMultipart()
            msg['From'] = f"Saudi Farms Notification <{sender_email}>"
            msg['To'] = to_email
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'html'))

            server = smtplib.SMTP(smtp_server, smtp_port)
            server.starttls()
            server.login(sender_email, sender_password)
            server.send_message(msg)
            server.quit()
        except Exception as e:
            print(f"Failed to send balance email to {to_email}: {e}")

def background_balance_checker():
    """Checks active batch balance every 2 minutes and emails if changed."""
    while True:
        with app.app_context():
            try:
                active_batches = Batch.query.filter_by(status='Active').all()
                users = User.query.filter_by(is_active=True).all()
                recipients = [u.email for u in users]

                if active_batches and recipients:
                    for batch in active_batches:
                        summary = _get_batch_summary_data(batch.id)
                        
                        # User Request Algorithm: Total Available Funds - Farm Expenses
                        current_balance = summary['total_funds'] - summary['farm_expenses']
                        
                        last_bal = batch.last_notified_balance

                        # Use a small epsilon for float comparison
                        if last_bal is None or abs(current_balance - last_bal) > 0.01:
                            print(f"[Balance Checker] Balance changed for {batch.name}: {last_bal} -> {current_balance}")
                            
                            try:
                                batch.last_notified_balance = current_balance
                                db.session.merge(batch) # Merge ensuring attached to session
                                db.session.commit()
                                print(f"[Balance Checker] Persisted new balance {current_balance}")
                                
                                # Send email after saving state
                                send_balance_update_email(batch.name, current_balance, last_bal, recipients)
                                
                            except Exception as db_err:
                                print(f"[Balance Checker] DB Error: {db_err}")
                                db.session.rollback()
                        
            except Exception as e:
                print(f"Background checker error: {e}")
            finally:
                 db.session.remove() # Now safe as it's within app_context

        time.sleep(120)

# Start Background Thread
# Use a lock-file approach or strictly WERKZEUG_RUN_MAIN to avoid double threads
if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
    # Ensure only one thread runs
    checker_thread = threading.Thread(target=background_balance_checker, daemon=True)
    checker_thread.start()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
