import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sevarath_mobile/features/auth/data/auth_repository.dart';

void main() {
  group('AuthRepository error-message mapping', () {
    test('joins a validation-error array into one message', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/auth/register'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/register'),
          statusCode: 400,
          data: {
            'statusCode': 400,
            'message': [
              'password must be at least 8 characters',
              'mobile must be a valid phone number',
            ],
          },
        ),
      );

      expect(
        messageForAuthError(dioError),
        'password must be at least 8 characters, mobile must be a valid phone number',
      );
    });

    test('passes through a single string message', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/auth/login/password'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/login/password'),
          statusCode: 401,
          data: {
            'statusCode': 401,
            'message': 'Invalid mobile/email or password',
          },
        ),
      );

      expect(messageForAuthError(dioError), 'Invalid mobile/email or password');
    });

    test('falls back to a generic message when the response has no body', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/auth/login/password'),
      );

      expect(
        messageForAuthError(dioError),
        'Something went wrong. Please try again.',
      );
    });
  });
}
