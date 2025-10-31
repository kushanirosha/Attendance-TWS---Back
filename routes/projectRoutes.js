import express from 'express';
import {
  getProjects,
  getProjectById,
  addProject,
  updateProject,
  deleteProject,
} from '../controllers/projectsController.js';

const router = express.Router();

router.get('/projects', getProjects);
router.get('/projects/:id', getProjectById);
router.post('/projects', addProject);
router.put('/projects/:id', updateProject);
router.delete('/projects/:id', deleteProject);

export default router;
