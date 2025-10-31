import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";

import employeeRoutes from './routes/employeeRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import projectRoutes from './routes/projectRoutes.js';

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.use('/api', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api', projectRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
