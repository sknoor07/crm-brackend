import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './modules/auth/auth.routes.js'; // <-- Import the routes
import jobRoutes from './modules/jobs/jobs.routes.js';
import csRoutes from './modules/customerService/cs.routes.js';
import transportRoutes from './modules/transport/transport.routes.js';
import fieldTechRoutes from './modules/fieldTech/transportPerson.routes.js';
import customerRoutes from './modules/customer/customer.routes.js';
import repairRoutes from './modules/repair/repair.routes.js';
import commentRoutes from './modules/jobs/comments.routes.js';
import rolesRoutes from './modules/roles/roles.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';


dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  }));
app.use(express.json());


// API Routes
app.use('/api/v1/auth', authRoutes); 
app.use('/api/v1/roles', rolesRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/cs', csRoutes);
app.use('/api/v1/transport', transportRoutes);
app.use('/api/v1/technician', fieldTechRoutes);
app.use('/api/v1/customer', customerRoutes);
app.use('/api/v1/comments',commentRoutes);

app.use('/api/v1/repair', repairRoutes);

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'API is running smoothly!' });
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});