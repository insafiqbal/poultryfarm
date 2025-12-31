from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    otp_hash = db.Column(db.String(128), nullable=True)
    otp_expiry = db.Column(db.DateTime, nullable=True)
    failed_login_attempts = db.Column(db.Integer, default=0)
    is_locked = db.Column(db.Boolean, default=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'is_active': self.is_active
        }

class Batch(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    start_date = db.Column(db.Date, default=datetime.utcnow)
    end_date = db.Column(db.Date, nullable=True)
    status = db.Column(db.String(20), default='Active')
    hima_percent = db.Column(db.Float, default=25.0)
    opening_balance = db.Column(db.Float, default=0.0)
    opening_balance_by = db.Column(db.String(50), nullable=True) # Farm, Kaleel, Iqbal
    expenses = db.relationship('Expense', backref='batch', lazy=True, cascade="all, delete-orphan")
    sales = db.relationship('Sale', backref='batch', lazy=True, cascade="all, delete-orphan")
    payables = db.relationship('HimaPayable', backref='batch', lazy=True, cascade="all, delete-orphan")
    deposits = db.relationship('Deposit', backref='batch', lazy=True, cascade="all, delete-orphan")
    estimate = db.relationship('Estimate', backref='batch', uselist=False, lazy=True, cascade="all, delete-orphan")
    last_notified_balance = db.Column(db.Float, default=None)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'start_date': self.start_date.isoformat(),
            'end_date': self.end_date.isoformat() if self.end_date else None,
            'status': self.status,
            'hima_percent': self.hima_percent,
            'opening_balance': self.opening_balance,
            'opening_balance_by': self.opening_balance_by
        }

class Worker(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    dob = db.Column(db.Date, nullable=True) # Date of Birth
    phone = db.Column(db.String(20), nullable=True)
    address = db.Column(db.String(200), nullable=True)
    emp_id = db.Column(db.String(50), nullable=True) # Employee ID
    active = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'dob': self.dob.isoformat() if self.dob else None,
            'phone': self.phone,
            'address': self.address,
            'emp_id': self.emp_id,
            'active': self.active
        }

class Expense(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('batch.id'), nullable=False)
    # Link to Worker (optional, only for Labour expenses)
    worker_id = db.Column(db.Integer, db.ForeignKey('worker.id'), nullable=True)
    is_advance = db.Column(db.Boolean, default=False)
    
    category = db.Column(db.String(50), nullable=False)
    ref_no = db.Column(db.String(50))
    date = db.Column(db.Date, nullable=False)
    subject = db.Column(db.String(200))
    qty = db.Column(db.Float, default=0.0)
    unit_price = db.Column(db.Float, default=0.0)
    total = db.Column(db.Float, default=0.0)
    receipt_url = db.Column(db.String(300), nullable=True)

    # Relationship
    worker = db.relationship('Worker', backref='expenses', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'batch_id': self.batch_id,
            'worker_id': self.worker_id,
            'worker_name': self.worker.name if self.worker else None,
            'is_advance': self.is_advance,
            'category': self.category,
            'ref_no': self.ref_no,
            'date': self.date.isoformat(),
            'subject': self.subject,
            'qty': self.qty,
            'unit_price': self.unit_price,
            'total': self.total,
            'receipt_url': self.receipt_url
        }

class Sale(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('batch.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    load_name = db.Column(db.String(100))
    qty_birds = db.Column(db.Integer, default=0)
    weight_kg = db.Column(db.Float, default=0.0)
    price_per_kg = db.Column(db.Float, default=0.0)
    total_amount = db.Column(db.Float, default=0.0)
    receipt_url = db.Column(db.String(300), nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'batch_id': self.batch_id,
            'date': self.date.isoformat(),
            'load_name': self.load_name,
            'qty_birds': self.qty_birds,
            'weight_kg': self.weight_kg,
            'price_per_kg': self.price_per_kg,
            'total_amount': self.total_amount,
            'receipt_url': self.receipt_url
        }

class HimaPayable(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('batch.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Float, default=0.0)
    receipt_url = db.Column(db.String(300), nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'batch_id': self.batch_id,
            'name': self.name,
            'amount': self.amount,
            'receipt_url': self.receipt_url
        }

class Deposit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('batch.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    amount = db.Column(db.Float, default=0.0)
    description = db.Column(db.String(200), nullable=True)
    deposited_by = db.Column(db.String(50), nullable=True) # Kaleel, Iqbal
    ref_no = db.Column(db.String(50), nullable=True)
    receipt_url = db.Column(db.String(300), nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'batch_id': self.batch_id,
            'date': self.date.isoformat(),
            'amount': self.amount,
            'description': self.description,
            'deposited_by': self.deposited_by,
            'ref_no': self.ref_no,
            'receipt_url': self.receipt_url
        }

class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    is_hima = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'is_hima': self.is_hima
        }

class Estimate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('batch.id'), nullable=False, unique=True)
    
    # Sales
    birds = db.Column(db.Float, default=0.0)
    weight = db.Column(db.Float, default=0.0)
    price = db.Column(db.Float, default=0.0)
    
    # Static Expenses
    chick_qty = db.Column(db.Float, default=0.0)
    chick_unit_price = db.Column(db.Float, default=0.0)
    chick_cost = db.Column(db.Float, default=0.0)
    medicine = db.Column(db.Float, default=0.0)
    feed_bags = db.Column(db.Float, default=0.0)
    feed_price = db.Column(db.Float, default=0.0)
    labour = db.Column(db.Float, default=0.0)
    food_labour = db.Column(db.Float, default=0.0)
    saw_dust = db.Column(db.Float, default=0.0)
    wood = db.Column(db.Float, default=0.0)
    other_cost = db.Column(db.Float, default=0.0)
    
    # Dynamic Lists (JSON encoded strings)
    extra_expenses = db.Column(db.Text, default='[]')
    hima_payables = db.Column(db.Text, default='[]')

    def to_dict(self):
        import json
        return {
            'id': self.id,
            'batch_id': self.batch_id,
            'birds': self.birds,
            'weight': self.weight,
            'price': self.price,
            'chick_qty': self.chick_qty,
            'chick_unit_price': self.chick_unit_price,
            'chick_cost': self.chick_cost,
            'medicine': self.medicine,
            'feed_bags': self.feed_bags,
            'feed_price': self.feed_price,
            'labour': self.labour,
            'food_labour': self.food_labour,
            'saw_dust': self.saw_dust,
            'wood': self.wood,
            'other_cost': self.other_cost,
            'extra_expenses': json.loads(self.extra_expenses),
            'hima_payables': json.loads(self.hima_payables)
        }
