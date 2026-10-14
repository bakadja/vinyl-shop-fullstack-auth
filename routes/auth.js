import { asyncHandler } from '../middleware/asyncHandler.js'
import { registerUser, loginUser, logoutUser } from '../controllers/authController.js'
import express from 'express'

export const authRouter = express.Router()

authRouter.post('/register', asyncHandler(registerUser))
authRouter.post('/login', asyncHandler(loginUser))
authRouter.get('/logout', asyncHandler(logoutUser))

